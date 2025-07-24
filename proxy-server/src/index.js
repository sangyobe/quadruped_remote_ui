const express = require('express');
const cors = require('cors');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const WebSocket = require('ws');
const util = require('util');
const protobuf = require('protobufjs');
require('dotenv').config();

console.log('Environment Variables:');
console.log(`PORT: ${process.env.PORT}`);
console.log(`WSS_PORT: ${process.env.WSS_PORT}`);
console.log(`STATE_SERVER_HOST: ${process.env.STATE_SERVER_HOST}`);
console.log(`GRPC_STATE_SERVER_PORT: ${process.env.GRPC_STATE_SERVER_PORT}`);
console.log(`GRPC_OPSTATE_SERVER_PORT: ${process.env.GRPC_OPSTATE_SERVER_PORT}`);
console.log(`GRPC_COMMAND_SERVER_PORT: ${process.env.GRPC_COMMAND_SERVER_PORT}`);
console.log(`GRPC_SERVER_HOST: ${process.env.GRPC_SERVER_HOST}`);

const app = express();
const PORT = process.env.PORT || 3001;

// Create WebSocket server
const WSS_PORT = process.env.WSS_PORT || 3005;

// Create WebSocket server
const wss = new WebSocket.Server({ port: WSS_PORT });

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
const DTSERVICE_PROTO_PATH = path.join(__dirname, '../proto/dtProto/Service.proto');
const ROBOTSTATE_PROTO_PATH = path.join(__dirname, '../proto/dtProto/robot_msgs/RobotState.proto');
const QUADRUPEDNAV_PROTO_PATH = path.join(__dirname, '../proto/QuadrupedNav.proto');
const DUALARM_PROTO_PATH = path.join(__dirname, '../proto/DualArm.proto');
const ROBOTCOMMAND_PROTO_PATH = path.join(__dirname, '../proto/dtProto/robot_msgs/RobotCommand.proto');
const CONTROLCMD_PROTO_PATH = path.join(__dirname, '../proto/dtProto/robot_msgs/ControlCmd.proto');

const packageDefinition = protoLoader.loadSync(
    [
        DTSERVICE_PROTO_PATH,
        QUADRUPEDNAV_PROTO_PATH,
        DUALARM_PROTO_PATH,
        ROBOTSTATE_PROTO_PATH,
        ROBOTCOMMAND_PROTO_PATH,
        CONTROLCMD_PROTO_PATH
    ],
    {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [
            path.join(__dirname, '../proto'),
            path.join(__dirname, '../proto/dtProto')
        ]
    }
);

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);

const quadrupedService = protoDescriptor.dtproto.quadruped.Nav;
const dtService = protoDescriptor.dtproto.dtService;
const RobotCommandTimeStamped = protoDescriptor.dtproto.RobotCommandTimeStamped;
const ControlCmd = protoDescriptor.dtproto.ControlCmd;

// Load DualArm.proto specifically with protobuf.js for reliable decoding
const root = new protobuf.Root();
root.loadSync(
    [
        DUALARM_PROTO_PATH
    ], 
    { 
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [
            path.join(__dirname, '../proto'),
            path.join(__dirname, '../proto/dtProto')
        ]
    }
);
const OperationStateTimeStamped = root.lookupType("dtproto.dualarm.OperationStateTimeStamped");
// const RobotCommandTimeStamped = root.lookupType("dtproto.robot_msgs.RobotCommandTimeStamped");
// const ControlCmd = root.lookupType("dtproto.robot_msgs.ControlCmd");


////////////////////////////////////////////////////////////////////////////////
// State streaming setup
let stateStream = null;

const startStateStreaming = () => {
    if (stateStream) {
        console.log('State stream already exists');
        return;
    }

    try {
        const stateClient = new dtService(
            `${process.env.GRPC_SERVER_HOST || '192.168.10.9'}:${process.env.GRPC_ROBOT_STATE_SERVER_PORT || 50053}`,
            grpc.credentials.createInsecure()
        );

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

////////////////////////////////////////////////////////////////////////////////
// opstate streaming setup
let opstateStream = null;

const startOpStateStreaming = () => {
    if (opstateStream) {
        console.log('Operation state stream already exists');
        return;
    }

    try {
        const opStateClient = new dtService(
            `${process.env.GRPC_SERVER_HOST || '192.168.10.9'}:${process.env.GRPC_OPSTATE_SERVER_PORT || 50060}`,
            grpc.credentials.createInsecure()
        );
        opstateStream = opStateClient.PublishState({});
        
        opstateStream.on('data', (response) => {
            const anyMessage = response.state;

            if (anyMessage && anyMessage.type_url && anyMessage.value) {
                const expectedTypeUrl = 'type.googleapis.com/dtproto.dualarm.OperationStateTimeStamped';

                if (anyMessage.type_url === expectedTypeUrl) {
                    try {
                        const decodedState = OperationStateTimeStamped.decode(anyMessage.value);
                        
                        if (decodedState.state) {
                            const opstate = {
                                op_mode: decodedState.state.op_mode,
                                op_status: decodedState.state.op_status
                            };

                            console.log('Received and decoded operation state:', opstate);

                            // Broadcast to all connected WebSocket clients
                            wss.clients.forEach((client) => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'opstate-update', data: opstate }));
                                }
                            });
                        }
                    } catch (e) {
                        console.error('Failed to decode Any message:', e);
                    }
                }
            }
        });

        opstateStream.on('error', (error) => {
            console.error('Operation state stream error:', error);
            opstateStream = null;
            setTimeout(startOpStateStreaming, 5000);
        });

        opstateStream.on('end', () => {
            console.log('Operation state stream ended');
            opstateStream = null;
            setTimeout(startOpStateStreaming, 5000);
        });

        console.log('Operation state streaming started');
    } catch (error) {
        console.error('Error creating operation state stream:', error);
        opstateStream = null;
        setTimeout(startOpStateStreaming, 5000);
    }
};

startOpStateStreaming();

////////////////////////////////////////////////////////////////////////////////
// robot command streaming setup
let commandStream = null;
let streamingInterval = null;
let currentVelocity = {
    linear: { x: 0, y: 0 },
    angular: 0
};

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
        // Create gRPC clients
        const commandClient = new quadrupedService(
            `${process.env.GRPC_SERVER_HOST || '192.168.10.9'}:${process.env.GRPC_NAV_COMMAND_SERVER_PORT || 50056}`,
            grpc.credentials.createInsecure()
        );

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

////////////////////////////////////////////////////////////////////////////////
// REST API endpoints
// app.post('/api/command', (req, res) => {
//     const { command } = req.body;

//     try {
//         switch(command) {
//             case 'Start':
//                 startCommandStreaming();
//                 res.json({ success: true });
//                 break;
//             case 'Stop':
//             case 'E-STOP':
//                 stopCommandStreaming();
//                 res.json({ success: true });
//                 break;
//             default:
//                 res.status(400).json({ error: 'Invalid command' });
//         }
//     } catch (error) {
//         console.error('Error handling command:', error);
//         res.status(500).json({ error: error.message });
//     }
// });

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

app.post('/api/sendRobotCommand', async (req, res) => {
    const { cmd_mode, arg, arg_n, arg_f } = req.body;

    try {
        const robotCommandClient = new dtService(
            `${process.env.GRPC_SERVER_HOST || '192.168.10.9'}:${process.env.GRPC_TASK_COMMAND_SERVER_PORT || 50052}`,
            grpc.credentials.createInsecure()
        );

        const controlCmd = {
            cmd_mode: parseInt(cmd_mode),
            arg: arg,
            arg_n: arg_n.map(Number),
            arg_f: arg_f.map(Number)
        };

        // Ensure arg_n and arg_f have 3 elements
        while (controlCmd.arg_n.length < 3) {
            controlCmd.arg_n.push(0);
        }
        while (controlCmd.arg_f.length < 3) {
            controlCmd.arg_f.push(0);
        }

        const robotCommand = {
            header: {
                stamp: {
                    sec: Math.floor(Date.now() / 1000),
                    nanosec: (Date.now() % 1000) * 1000000
                },
                frame_id: "robot_command"
            },
            command: {
                cmd: controlCmd
            }
        };

        robotCommandClient.RobotCommand(robotCommand, (error, response) => {
            if (!error) {
                res.json({ success: true, response: response });
            } else {
                console.error('Error sending RobotCommand:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

    } catch (error) {
        console.error('Error processing RobotCommand:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

////////////////////////////////////////////////////////////////////////////////
// Start server
app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
}); 