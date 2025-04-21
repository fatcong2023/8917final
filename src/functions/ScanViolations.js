const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { EmailClient } = require("@azure/communication-email");

// Singleton pattern for database connection
let mongoClient = null;
let database = null;

// Singleton pattern for email client
let emailClient = null;

/**
 * Gets a MongoDB client connection
 * @returns {Promise<MongoClient>} MongoDB client
 */
async function getMongoClient() {
  if (!mongoClient) {
    const connectionString = process.env.MONGODB_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error("MONGODB_CONNECTION_STRING environment variable is not configured");
    }
    
    mongoClient = new MongoClient(connectionString, {
      socketTimeoutMS: 30000,
      maxPoolSize: 50,
      minPoolSize: 10,
      retryWrites: true,
      serverSelectionTimeoutMS: 10000
    });
    
    await mongoClient.connect();
    database = mongoClient.db("geofence");
  }
  
  return mongoClient;
}

/**
 * Gets an Azure Communication Services Email client
 * @returns {EmailClient} Email client
 */
function getEmailClient() {
  if (!emailClient) {
    const connectionString = process.env.COMMUNICATION_SERVICES_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error("COMMUNICATION_SERVICES_CONNECTION_STRING environment variable is not configured");
    }
    
    emailClient = new EmailClient(connectionString);
  }
  
  return emailClient;
}

/**
 * Send geofence violation email to user
 * @param {object} violation Violation record
 * @param {object} context Azure Function context for logging
 * @returns {Promise<object>} Email send operation result
 */
async function sendViolationEmail(violation, context) {
  const client = getEmailClient();
  
  context.log(`Preparing to send violation email to ${violation.email} for vehicle ${violation.vehicleId}`);
  
  const emailMessage = {
    senderAddress: "DoNotReply@effb8301-a959-4afd-9644-9a9df77c49b2.azurecomm.net",
    content: {
      subject: "URGENT: Geofence Boundary Violation Alert",
      plainText: `Your vehicle with ID ${violation.vehicleId} is now outside the allowed boundary. A $10,000 fine will be charged if not returned immediately.`,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; border: 1px solid #ddd; padding: 20px; border-radius: 5px;">
              <h1 style="color: #cc0000; margin-top: 0;">⚠️ Geofence Violation Alert</h1>
              <p>This is an automated notification about a geofence boundary violation.</p>
              <div style="background-color: #f8f8f8; border-left: 4px solid #cc0000; padding: 15px; margin: 20px 0;">
                <p><strong>Vehicle ID:</strong> ${violation.vehicleId}</p>
                <p><strong>Violation Time:</strong> ${new Date(violation.timestamp).toLocaleString()}</p>
                <p><strong>Last Known Location:</strong> [${violation.latitude.toFixed(6)}, ${violation.longitude.toFixed(6)}]</p>
              </div>
              <p style="font-weight: bold; color: #cc0000;">Your vehicle is now outside the allowed boundary. A $10,000 fine will be charged if the vehicle is not returned to the authorized area immediately.</p>
              <p>Please take immediate action to return your vehicle to the authorized area.</p>
              <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
              <p style="font-size: 12px; color: #666;">This is an automated message. Do not reply to this email.</p>
            </div>
          </body>
        </html>`,
    },
    recipients: {
      to: [{ address: violation.email }],
    },
  };

  try {
    context.log(`Sending email to ${violation.email}`);
    const poller = await client.beginSend(emailMessage);
    const result = await poller.pollUntilDone();
    
    context.log(`Email sent successfully to ${violation.email}, message ID: ${result.messageId}`);
    return result;
  } catch (error) {
    context.error(`Failed to send email to ${violation.email}: ${error.message}`);
    throw error;
  }
}

/**
 * Update violation record to mark warning as sent
 * @param {string} violationId ID of the violation record
 * @param {object} context Azure Function context for logging
 * @returns {Promise<object>} Update operation result
 */
async function markViolationAsWarned(violationId, context) {
  try {
    await getMongoClient();
    const collection = database.collection("violations");
    
    const result = await collection.updateOne(
      { violationId: violationId },
      { 
        $set: { 
          warningSent: true,
          warningSentAt: new Date()
        }
      }
    );
    
    context.log(`Updated violation record ${violationId}, matched: ${result.matchedCount}, modified: ${result.modifiedCount}`);
    return result;
  } catch (error) {
    context.error(`Failed to update violation record ${violationId}: ${error.message}`);
    throw error;
  }
}

/**
 * Fetch all unsent violation warnings
 * @param {object} context Azure Function context for logging
 * @returns {Promise<Array>} List of violations with warnings not yet sent
 */
async function getUnsentViolations(context) {
  try {
    await getMongoClient();
    const collection = database.collection("violations");
    
    // Find all violations where warningSent is false
    const violations = await collection.find({ warningSent: false }).toArray();
    
    context.log(`Found ${violations.length} violations with unsent warnings`);
    return violations;
  } catch (error) {
    context.error(`Failed to fetch unsent violations: ${error.message}`);
    throw error;
  }
}

/**
 * Clean up resources - close database connection
 */
async function cleanupResources() {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
    database = null;
  }
}

// Register timer trigger that runs every minute
app.timer('scanViolations', {
  schedule: '0 * * * * *', // Every minute (second minute hour day month weekday)
  handler: async (myTimer, context) => {
    context.log('Violation scanner timer trigger function started');
    
    try {
      // Get all violations with unsent warnings
      const violations = await getUnsentViolations(context);
      
      if (violations.length === 0) {
        context.log('No new violations to process');
        return;
      }
      
      // Process each violation
      let successCount = 0;
      let failCount = 0;
      
      for (const violation of violations) {
        try {
          context.log(`Processing violation ${violation.violationId} for vehicle ${violation.vehicleId}`);
          
          // Send email notification
          await sendViolationEmail(violation, context);
          
          // Mark the violation as warned
          await markViolationAsWarned(violation.violationId, context);
          
          successCount++;
        } catch (error) {
          context.error(`Error processing violation ${violation.violationId}: ${error.message}`);
          failCount++;
          
          // Continue with the next violation even if this one failed
          continue;
        }
      }
      
      context.log(`Violation processing completed. Success: ${successCount}, Failed: ${failCount}`);
    } catch (error) {
      context.error(`Function execution failed: ${error.message}`);
      throw error; // Let the Azure Functions runtime handle the error
    } finally {
      // Always ensure resources are cleaned up
      await cleanupResources();
    }
  }
});

// Register cleanup handlers for graceful shutdowns
process.on('SIGTERM', cleanupResources);
process.on('SIGINT', cleanupResources);