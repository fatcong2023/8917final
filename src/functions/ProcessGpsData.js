const { app } = require('@azure/functions');
const geofenceService = require('../services/GeofenceService');

app.serviceBusQueue('processGpsData', {
    queueName: process.env.SERVICE_BUS_QUEUE_NAME || 'gps',
    connection: 'SERVICE_BUS_CONNECTION_STRING',
    handler: (message, context) => {
        // context.log('Service AAA:', message);
        // context.log('EnqueuedTimeUtc =', context.triggerMetadata.enqueuedTimeUtc);
        // context.log('DeliveryCount =', context.triggerMetadata.deliveryCount);
        // context.log('MessageId =', context.triggerMetadata.messageId);

        const { timestamp, vehicleId, latitude, longitude } = message;
        
        // Determine if the vehicle is inside the geofence
        const isInside = geofenceService.isWithinGeofence(longitude, latitude);
        
        if(isInside) {
            context.log(`Vehicle ${vehicleId} at [${latitude}, ${longitude}] is ${isInside ? 'INSIDE' : 'OUTSIDE'} the geofence`);
        }
        else {
            context.warn(`Vehicle ${vehicleId} at [${latitude}, ${longitude}] is ${isInside ? 'INSIDE' : 'OUTSIDE'} the geofence`);
        }
    }
});
