const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');

// Singleton pattern for database connection
let mongoClient = null;
let database = null;

/**
 * Gets a MongoDB client connection with retry logic
 * @returns {Promise<MongoClient>} MongoDB client
 */
async function getMongoClient() {
  // If we already have a client and database, return it
  if (mongoClient && database) {
    return mongoClient;
  }
  
  // Initialize a new connection
  const connectionString = process.env.MONGODB_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error("MONGODB_CONNECTION_STRING environment variable is not configured");
  }
  
  // Create client with MongoDB driver options following Azure best practices
  mongoClient = new MongoClient(connectionString, {
    socketTimeoutMS: 30000,
    maxPoolSize: 50,
    minPoolSize: 5,
    retryWrites: true,
    retryReads: true,
    serverSelectionTimeoutMS: 10000
  });
  
  await mongoClient.connect();
  
  // Test the connection with a ping
  await mongoClient.db("admin").command({ ping: 1 });
  
  database = mongoClient.db("geofence");
  
  return mongoClient;
}

/**
 * Purge processed violations (warnings sent) from the database
 * @param {object} context Azure Function context for logging
 * @returns {Promise<object>} Delete operation result
 */
async function purgeProcessedViolations(context) {
  try {
    await getMongoClient();
    
    if (!database) {
      throw new Error("Database connection not initialized");
    }
    
    const collection = database.collection("violations");
    
    // Get a count before deletion for reporting
    const countBefore = await collection.countDocuments({ warningSent: true });
    context.log(`Found ${countBefore} processed violations to purge`);
    
    if (countBefore === 0) {
      return { deletedCount: 0 };
    }
    
    // Delete all documents where warningSent is true
    const result = await collection.deleteMany({ warningSent: true });
    
    context.log(`Purged ${result.deletedCount} processed violations`);
    return result;
  } catch (error) {
    context.error(`Failed to purge processed violations: ${error.message}`);
    throw error;
  }
}

/**
 * Clean up resources - close database connection
 */
async function cleanupResources() {
  if (mongoClient) {
    try {
      await mongoClient.close();
      console.log("MongoDB connection closed");
    } catch (err) {
      console.error("Error closing MongoDB connection:", err);
    } finally {
      mongoClient = null;
      database = null;
    }
  }
}

// Register timer trigger that runs once every 24 hours at midnight UTC
app.timer('purgeProcessedViolations', {
  schedule: '0 0 0 * * *', // Run at midnight (0 0 0 = second minute hour)
  handler: async (myTimer, context) => {
    const invocationId = context.invocationId;
    const timeStamp = new Date().toISOString();
    
    context.log(`Purge data function executed at ${timeStamp} (Invocation ID: ${invocationId})`);
    
    try {
      // Create a transaction-like pattern with comprehensive error handling
      const startTime = Date.now();
      
      // 1. Connect to database 
      await getMongoClient();
      
      // 2. Get pre-operation stats for reporting
      const countBeforePurge = await database.collection("violations").countDocuments();
      
      // 3. Perform the purge operation
      const result = await purgeProcessedViolations(context);
      
      // 4. Get post-operation stats
      const countAfterPurge = await database.collection("violations").countDocuments();
      const executionTimeMs = Date.now() - startTime;
      
      // 5. Log comprehensive metrics
      context.log({
        message: "Purge operation completed successfully",
        operation: "purgeProcessedViolations",
        violationsCountBefore: countBeforePurge,
        violationsCountAfter: countAfterPurge,
        purgedCount: result.deletedCount,
        executionTimeMs: executionTimeMs,
        timestamp: timeStamp
      });
      
      return {
        purgedCount: result.deletedCount,
        executionTimeMs: executionTimeMs
      };
    } catch (error) {
      context.error(`Error during purge operation: ${error.message}`, error);
      
      // Let the Azure Functions runtime handle the error
      throw error;
    } finally {
      // Always clean up resources
      await cleanupResources();
    }
  }
});

// Register cleanup handlers for graceful shutdowns
process.on('SIGTERM', cleanupResources);
process.on('SIGINT', cleanupResources);