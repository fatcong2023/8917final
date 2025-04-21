const { MongoClient } = require('mongodb');
const { randomUUID } = require('crypto'); // Built-in Node.js module for UUID generation

// Use a singleton pattern for MongoDB connection
let client = null;
let database = null;

/**
 * Get a connected MongoDB client
 * @returns {Promise<MongoClient>} MongoDB client
 */
async function getMongoClient() {
  try {
    console.log("Attempting to get MongoDB client");
    
    if (!client) {
      console.log("No existing client, creating new connection");
      const connectionString = process.env.MONGODB_CONNECTION_STRING || 
        "mongodb://cst8917comosfinal:7i8YB2uwmMu1N3t7B9BUyxsrpOsMDE9z4P3xi1gcGGtkEK2ByRW2wAFfAyUcHN0yMAdQSBwKkgduACDbMkCm2w==@cst8917comosfinal.mongo.cosmos.azure.com:10255/?ssl=true&replicaSet=globaldb&retrywrites=false&maxIdleTimeMS=120000&appName=@cst8917comosfinal@";
      
      console.log("Connection string (first 20 chars): " + connectionString.substring(0, 20) + "...");
      
      client = new MongoClient(connectionString, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      
      console.log("Connecting to MongoDB...");
      await client.connect();
      console.log("Connected successfully!");
      
      database = client.db("geofence");
      console.log("Database selected: geofence");
    } else {
      console.log("Using existing MongoDB client connection");
    }
    
    if (!database) {
      console.error("Database is null after connection!");
    }
    
    return client;
  } catch (err) {
    console.error("Error connecting to MongoDB:", err);
    throw err;
  }
}

/**
 * Find a vehicle in the userVehicles collection
 * @param {string} vehicleId - The vehicle ID to search for
 * @param {object} context - Azure Functions logger context
 * @returns {Promise<object|null>} The vehicle document or null if not found
 */
async function findVehicleUser(vehicleId, context) {
  try {
    await getMongoClient();
    
    // Double-check database is initialized
    if (!database) {
      context.error("Database object is null, reinitializing");
      client = null; // Force recreation
      await getMongoClient();
      
      if (!database) {
        throw new Error("Failed to initialize database connection");
      }
    }
    
    const collection = database.collection("userVehicles");
    
    context.log(`Looking up vehicle ID: ${vehicleId}`);
    
    // Find the vehicle by vid field (matches vehicleId)
    const vehicle = await collection.findOne({ vid: vehicleId });
    
    if (vehicle) {
      context.log(`Found vehicle ${vehicleId} associated with email: ${vehicle.email}`);
    } else {
      context.warn(`No ownership record found for vehicle ${vehicleId}`);
    }
    
    return vehicle;
  } catch (error) {
    context.error(`Error finding vehicle ${vehicleId}: ${error.message}`);
    throw error;
  }
}

/**
 * Store a geofence violation in the database
 * @param {object} violationData - The violation data to store
 * @param {object} context - Azure Functions logger context
 * @returns {Promise<object>} The result of the insert operation
 */
async function storeViolation(violationData, context) {
  try {
    await getMongoClient();
    const collection = database.collection("violations");
    
    context.log(`Storing violation for vehicle ${violationData.vehicleId}`);
    
    // Generate a UUID for violationId
    const violationId = randomUUID();
    
    // Insert the violation record with UUID
    const result = await collection.insertOne({
      violationId: violationId,
      vehicleId: violationData.vehicleId,
      email: violationData.email,
      latitude: violationData.latitude,
      longitude: violationData.longitude,
      timestamp: violationData.timestamp,
      warningSent: false,
      created: new Date() // Add server-side timestamp
    });
    
    context.log(`Violation stored with ID: ${result.insertedId}, violationId: ${violationId}`);
    
    return result;
  } catch (error) {
    context.error(`Error storing violation: ${error.message}`);
    throw error;
  }
}

/**
 * Close the MongoDB connection when the application shuts down
 */
async function closeConnection() {
  if (client) {
    await client.close();
    client = null;
    database = null;
  }
}

// Register cleanup handlers
process.on('SIGTERM', closeConnection);
process.on('SIGINT', closeConnection);

module.exports = {
  findVehicleUser,
  storeViolation,
  closeConnection
};