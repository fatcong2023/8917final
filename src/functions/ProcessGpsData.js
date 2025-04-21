const { app } = require('@azure/functions');
const geofenceService = require('../services/GeofenceService');
const violationService = require('../services/StoreViolationService');
const { randomUUID } = require('crypto'); // Built-in Node.js module for UUID generation

app.serviceBusQueue('processGpsData', {
    queueName: process.env.SERVICE_BUS_QUEUE_NAME || 'gps',
    connection: 'SERVICE_BUS_CONNECTION_STRING',
    handler: async (message, context) => {
        try {
            // Extract GPS data from the message
            const { timestamp, vehicleId, latitude, longitude } = message;
            
            context.log(`Processing GPS data: vehicleId=${vehicleId}, timestamp=${timestamp}, coords=[${latitude}, ${longitude}]`);
            
            // Check if the vehicle is inside or outside the geofence
            const isInside = geofenceService.isWithinGeofence(longitude, latitude);
            
            if (isInside) {
                context.log(`Vehicle ${vehicleId} at [${latitude}, ${longitude}] is INSIDE the geofence`);
                // Vehicle is inside the geofence - no violation to record
            } else {
                context.warn(`Vehicle ${vehicleId} at [${latitude}, ${longitude}] is OUTSIDE the geofence`);
                
                // VIOLATION DETECTED: Find the vehicle owner and store the violation
                try {
                    // Look up the vehicle in the database to get the owner's email
                    const vehicleRecord = await violationService.findVehicleUser(vehicleId, context);
                    
                    if (vehicleRecord) {
                        // Store the violation in the database
                        await violationService.storeViolation({
                            vehicleId: vehicleId,
                            email: vehicleRecord.email,
                            latitude: latitude,
                            longitude: longitude,
                            timestamp: timestamp
                        }, context);
                        
                        context.log(`Violation for vehicle ${vehicleId} stored successfully`);
                        
                        // Here you could send a notification to the vehicle owner
                        // e.g., by triggering another function via a queue or event grid
                    } else {
                        context.warn(`Cannot record violation: No owner found for vehicle ${vehicleId}`);
                    }
                } catch (dbError) {
                    context.error(`Database operation failed: ${dbError.message}`, dbError);
                    // Consider implementing a dead-letter pattern here for failed records
                }
            }
        } catch (error) {
            context.error(`Error processing message: ${error.message}`, error);
            // For critical errors, consider throwing to trigger Azure Functions retry policy
            throw error;
        }
    }
});
