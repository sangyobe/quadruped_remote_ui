const express = require('express');
const cors = require('cors');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Create WebSocket server
const wss = new WebSocket.Server({ port: 3005 });

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('New WebSocket client connected');
    
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Broadcast function for WebSocket
const broadcastState = (state) => {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(state));
        }
    });
};

// Middleware
app.use(cors());
app.use(express.json());

// Load proto files
const PROTO_PATH = path.join(__dirname, '../proto/QuadrupedNav.proto');
const STATE_PROTO_PATH = path.join(__dirname, '../proto/dtProto/Service.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [path.join(__dirname, '../proto')]
});

const statePackageDefinition = protoLoader.loadSync(STATE_PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [path.join(__dirname, '../proto')]
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const stateProtoDescriptor = grpc.loadPackageDefinition(statePackageDefinition);

const quadrupedService = protoDescriptor.dtproto.quadruped.Nav;
const stateService = stateProtoDescriptor.dtproto.dtService;

// Create gRPC clients
const commandClient = new quadrupedService(
    `${process.env.GRPC_SERVER_HOST || 'localhost'}:${process.env.GRPC_COMMAND_SERVER_PORT || 50056}`,
    grpc.credentials.createInsecure()
);

const stateClient = new stateService(
    `${process.env.STATE_SERVER_HOST || 'localhost'}:${process.env.GRPC_STATE_SERVER_PORT || 50053}`,
    grpc.credentials.createInsecure()
);

// Global state for command streaming
let commandStream = null;
let streamingInterval = null;
let currentVelocity = {
    linear: { x: 0, y: 0 },
    angular: 0
};

// State streaming setup
let stateStream = null;

const startStateStreaming = () => {
    if (stateStream) {
        console.log('State stream already exists');
        return;
    }

    try {
        stateStream = stateClient.PublishState({});
        
        stateStream.on('data', (response) => {
            // Extract position and orientation from state
            // console.log('Received state update:', response.state);
            const state = {
                x: 1.0, // response.state.base_pose.position.x,
                y: 1.0, //response.state.base_pose.position.y,
                theta: 0.0 //response.state.base_pose.orientation.z // Assuming z is the yaw angle
            };
            // Broadcast to all connected WebSocket clients
            broadcastState(state);
        });

        stateStream.on('error', (error) => {
            console.error('State stream error:', error);
            stateStream = null;
            // Attempt to reconnect after a delay
            setTimeout(startStateStreaming, 5000);
        });

        stateStream.on('end', () => {
            console.log('State stream ended');
            stateStream = null;
            // Attempt to reconnect after a delay
            setTimeout(startStateStreaming, 5000);
        });

        console.log('State streaming started');
    } catch (error) {
        console.error('Error creating state stream:', error);
        stateStream = null;
        // Attempt to reconnect after a delay
        setTimeout(startStateStreaming, 5000);
    }
};

// Start state streaming when server starts
startStateStreaming();

// Function to create and send command message
const createCommandMessage = () => {
    return {
        header: {
            stamp: {
                sec: Math.floor(Date.now() / 1000),
                nanosec: (Date.now() % 1000) * 1000000
            },
            frame_id: "base_link"
        },
        command: {
            nav: {
                se2_target_vel: {
                    vel: currentVelocity,
                    end_time: {
                        seconds: Math.floor(Date.now() / 1000) + 1,
                        nanos: 0
                    }
                }
            }
        }
    };
};

// Function to start command streaming
const startCommandStreaming = () => {
    if (commandStream) {
        console.log('Command stream already exists');
        return;
    }

    try {
        commandStream = commandClient.SubscribeRobotCommand((error, response) => {
            if (!error) {
                console.log('\n[Client] Received response from server:');
            } else {
                console.error('[Client] Error during client-side streaming:', error.message);
            }
        });
        
        commandStream.on('data', (response) => {
            console.log('Received response:', response);
        });

        commandStream.on('error', (error) => {
            console.error('Stream error:', error);
            stopCommandStreaming();
        });

        commandStream.on('end', () => {
            console.log('Stream ended');
            stopCommandStreaming();
        });

        // Start periodic sending of commands
        streamingInterval = setInterval(() => {
            if (commandStream) {
                commandStream.write(createCommandMessage());
            }
        }, 50); // 20 times per second

        console.log('Command streaming started');
    } catch (error) {
        console.error('Error creating command stream:', error);
        stopCommandStreaming();
    }
};

// Function to stop command streaming
const stopCommandStreaming = () => {
    if (streamingInterval) {
        clearInterval(streamingInterval);
        streamingInterval = null;
    }
    
    if (commandStream) {
        commandStream.end();
        commandStream = null;
    }

    // Reset velocity
    currentVelocity = {
        linear: { x: 0, y: 0 },
        angular: 0
    };

    console.log('Command streaming stopped');
};

// REST API endpoints
app.post('/api/command', (req, res) => {
    const { command } = req.body;

    try {
        switch(command) {
            case 'Start':
                startCommandStreaming();
                res.json({ success: true });
                break;
            case 'Stop':
            case 'E-STOP':
                stopCommandStreaming();
                res.json({ success: true });
                break;
            default:
                res.status(400).json({ error: 'Invalid command' });
        }
    } catch (error) {
        console.error('Error handling command:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/movement', (req, res) => {
    const { speed, direction } = req.body;

    try {
        const normalizedSpeed = speed / 100; // Convert 0-100 to 0-1

        // Update velocity based on direction
        switch(direction) {
            case 'forward':
                currentVelocity.linear.x = normalizedSpeed;
                currentVelocity.linear.y = 0;
                currentVelocity.angular = 0;
                break;
            case 'backward':
                currentVelocity.linear.x = -normalizedSpeed;
                currentVelocity.linear.y = 0;
                currentVelocity.angular = 0;
                break;
            case 'left':
                currentVelocity.linear.x = 0;
                currentVelocity.linear.y = normalizedSpeed;
                currentVelocity.angular = 0;
                break;
            case 'right':
                currentVelocity.linear.x = 0;
                currentVelocity.linear.y = -normalizedSpeed;
                currentVelocity.angular = 0;
                break;
            case 'rotate_left':
                currentVelocity.linear.x = 0;
                currentVelocity.linear.y = 0;
                currentVelocity.angular = normalizedSpeed;
                break;
            case 'rotate_right':
                currentVelocity.linear.x = 0;
                currentVelocity.linear.y = 0;
                currentVelocity.angular = -normalizedSpeed;
                break;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error handling movement:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
}); 