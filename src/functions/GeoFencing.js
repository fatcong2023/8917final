const { app } = require('@azure/functions');
const { ServiceBusClient } = require('@azure/service-bus');

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
        console.log(`Http function processed request for url "${request.url}"`);

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
        
        // Center point coordinates
        const centerLat = 45.39574634172982;
        const centerLng = -75.74740191869692;
        const radiusKm = 20;
        const pointCount = 100;
        
        try {
            // Generate random GPS points
            const gpsPoints = generateRandomPointsInRadius(centerLat, centerLng, radiusKm, pointCount);
            
            // Connection string for Service Bus
            const connectionString = "Endpoint=sb://cst8917finalxiao.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=xCWNujVff35nszzKzrrdsms3kCGgnr04r+ASbB7p6dk=";
            const queueName = "gps";
            
            // Create a Service Bus client
            const sbClient = new ServiceBusClient(connectionString);
            const sender = sbClient.createSender(queueName);
            
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
            await sender.sendMessages({ body: message });
            context.log('Message sent to Service Bus');
            
            // Close the sender and client
            await sender.close();
            await sbClient.close();
            
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
