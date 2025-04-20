const { app } = require('@azure/functions');
const { ServiceBusClient } = require('@azure/service-bus');

// Singleton Service Bus client for reuse across invocations
let serviceBusClient = null;
let serviceBusSender = null;

// Initialize Service Bus client
function initServiceBusClient() {
    if (!serviceBusClient) {
        const connectionString = process.env.SERVICE_BUS_CONNECTION_STRING;
        if (!connectionString) {
            throw new Error("SERVICE_BUS_CONNECTION_STRING environment variable is not configured");
        }
        serviceBusClient = new ServiceBusClient(connectionString);
    }
    return serviceBusClient;
}

// Function to generate random points within a radius
function generateRandomPointsInRadius(centerLat, centerLng, radiusInKm, count) {
    const points = [];
    const earthRadiusKm = 6371; // Earth's radius in kilometers
    
    for (let i = 0; i < count; i++) {
        // Convert radius from kilometers to degrees
        const radiusInDegrees = radiusInKm / earthRadiusKm;
        
        // Generate a random distance within the radius
        const u = Math.random();
        const v = Math.random();
        
        const w = radiusInDegrees * Math.sqrt(u);
        const t = 2 * Math.PI * v;
        const x = w * Math.cos(t);
        const y = w * Math.sin(t);
        
        // Adjust the x-coordinate for the shrinking of the east-west distances
        const newX = x / Math.cos(centerLat * Math.PI / 180);
        
        // Calculate final coordinates
        const newLat = centerLat + y * (180 / Math.PI);
        const newLng = centerLng + newX * (180 / Math.PI);
        
        points.push({ latitude: newLat, longitude: newLng });
    }
    
    return points;
}

// Original HTTP trigger
app.http('httpTriggerOne', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log(`Http function processed request for url "${request.url}"`);

        const name = request.query.get('name') || await request.text() || 'world';

        return { body: `Hello, ${name}!` };
    }
});

// New GPS points generator endpoint
app.http('generateGpsPoints', {
    methods: ['POST'],
    route: 'generate',
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log('Processing request to generate GPS points');
        
        try {
            // Parse request body if provided, otherwise use defaults
            let requestData = {};
            try {
                const requestBody = await request.text();
                if (requestBody) {
                    requestData = JSON.parse(requestBody);
                }
            } catch (parseError) {
                context.log.warn('Failed to parse request body, using defaults', parseError);
            }
            
            // Use parameters from request or defaults
            const centerLat = requestData.latitude || 45.39574634172982;
            const centerLng = requestData.longitude || -75.74740191869692;
            const radiusKm = requestData.radiusKm || 20;
            const pointCount = requestData.pointCount || 100;
            
            // Generate random GPS points
            const gpsPoints = generateRandomPointsInRadius(centerLat, centerLng, radiusKm, pointCount);
            
            // Initialize Service Bus client and sender
            const queueName = process.env.SERVICE_BUS_QUEUE_NAME || "gps";
            
            try {
                const sbClient = initServiceBusClient();
                if (!serviceBusSender) {
                    serviceBusSender = sbClient.createSender(queueName);
                }
                
                // Create message with timestamp
                const message = {
                    timestamp: new Date().toISOString(),
                    center: {
                        latitude: centerLat,
                        longitude: centerLng
                    },
                    radiusKm: radiusKm,
                    points: gpsPoints
                };
                
                // Send the message
                await serviceBusSender.sendMessages({ body: message });
                context.log('Message sent to Service Bus queue:', queueName);
                
                return {
                    status: 200,
                    body: JSON.stringify({
                        success: true,
                        message: `Generated ${pointCount} GPS points within ${radiusKm}km radius and sent to Service Bus`,
                        data: message
                    }),
                    headers: {
                        'Content-Type': 'application/json'
                    }
                };
            } catch (sbError) {
                throw new Error(`Service Bus error: ${sbError.message}`);
            }
        } catch (error) {
            context.error('Error processing request:', error);
            return {
                status: 500,
                body: JSON.stringify({
                    success: false,
                    error: `Failed to process request: ${error.message}`
                }),
                headers: {
                    'Content-Type': 'application/json'
                }
            };
        }
    }
});

// Add a function to clean up resources on app shutdown
app.onShutdown(async () => {
    if (serviceBusSender) {
        await serviceBusSender.close();
    }
    if (serviceBusClient) {
        await serviceBusClient.close();
    }
});
