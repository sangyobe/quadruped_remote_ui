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
console.log(`GRPC_SERVER_HOST: ${process.env.GRPC_SERVER_HOST}`);
console.log(`GRPC_ROBOT_STATE_SERVER_PORT: ${process.env.GRPC_ROBOT_STATE_SERVER_PORT}`);
console.log(`GRPC_OPSTATE_SERVER_PORT: ${process.env.GRPC_OPSTATE_SERVER_PORT}`);
console.log(`GRPC_NAV_COMMAND_SERVER_PORT: ${process.env.GRPC_NAV_COMMAND_SERVER_PORT}`);
console.log(`GRPC_TASK_COMMAND_SERVER_PORT: ${process.env.GRPC_TASK_COMMAND_SERVER_PORT}`);

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
            path.join(__dirname, '../proto')
        ]
    }
);

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);

const quadrupedService = protoDescriptor.dtproto.quadruped.Nav;
const dtService = protoDescriptor.dtproto.dtService;
// const RobotCommandTimeStamped = protoDescriptor.dtproto.RobotCommandTimeStamped;
// const ControlCmd = protoDescriptor.dtproto.ControlCmd;

// Load DualArm.proto specifically with protobuf.js for reliable decoding
const root = new protobuf.Root();

// Override resolvePath
root.resolvePath = function (origin, target) {
    // console.log(`resolvePath 호출됨 - Origin: ${origin}, Target: ${target}`);

    // 여기에 사용자 정의 로직을 구현합니다.
    // 예를 들어, 모든 임포트를 'proto' 디렉토리에서 찾도록 합니다.
    const protoDir = path.resolve(__dirname, '../proto'); // 'proto' 디렉토리의 절대 경로

    // target이 절대 경로가 아닌 경우, protoDir에서 찾도록 합니다.
    // 여기서는 간단하게 protoDir 안에 target이 바로 있다고 가정합니다.
    const resolvedPath = path.join(protoDir, target);

    // console.log(`Resolved path: ${resolvedPath}`);
    return resolvedPath;

    // 만약 특정 파일을 무시하고 싶다면 null을 반환합니다.
    // if (target === 'google/protobuf/timestamp.proto') {
    //     return null;
    // }
};

root.loadSync(
    [
        // DUALARM_PROTO_PATH
        'DualArm.proto',
        'dtProto/robot_msgs/RobotState.proto',
        // 'dtProto/robot_msgs/RobotCommand.proto',
        // 'dtProto/robot_msgs/ControlCmd.proto'
    ], 
    { 
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [
            path.join(__dirname, '../proto')
        ]
    }
);
const OperationStateTimeStamped = root.lookupType("dtproto.dualarm.OperationStateTimeStamped");
const RobotStateTimeStamped = root.lookupType("dtproto.robot_msgs.RobotStateTimeStamped");
// const RobotCommandTimeStamped = root.lookupType("dtproto.robot_msgs.RobotCommandTimeStamped");
// const ControlCmd = root.lookupType("dtproto.robot_msgs.ControlCmd");


////////////////////////////////////////////////////////////////////////////////
// Robot State streaming setup
let robotStateStream = null;
let lastRobotStateUpdateTime = 0; // Add this line to track last update(broadcast) time
let lastRobotStateLoggingTime = 0; // Add this line to track last console.log time

const startRobotStateStreaming = () => {
    if (robotStateStream) {
        console.log('Robot state stream already exists');
        return;
    }

    try {
        const robotStateClient = new dtService(
            `${process.env.GRPC_SERVER_HOST || '192.168.10.9'}:${process.env.GRPC_ROBOT_STATE_SERVER_PORT || 50053}`,
            grpc.credentials.createInsecure()
        );

        robotStateStream = robotStateClient.PublishState({});
        
        robotStateStream.on('data', (response) => {
            const anyMessage = response.state;

            if (anyMessage && anyMessage.type_url && anyMessage.value) {
                const expectedTypeUrl = 'type.googleapis.com/dtproto.robot_msgs.RobotStateTimeStamped';

                if (anyMessage.type_url === expectedTypeUrl) {
                    try {
                        // Extract position and orientation from state
                        const decodedState = RobotStateTimeStamped.decode(anyMessage.value);

                        if (decodedState.state) {
                            const { position, orientation } = decodedState.state.base_pose;
                            const yaw = Math.atan2(2 * (orientation.w * orientation.z + orientation.x * orientation.y), 1 - 2 * (orientation.y * orientation.y + orientation.z * orientation.z));
                            const robotstate = {
                                x: position.x,
                                y: position.y,
                                theta: yaw
                            };

                            const currentTime = Date.now();

                            if (currentTime - lastRobotStateUpdateTime >= 100) { // Check time for broadcasting message
                                // Broadcast to all connected WebSocket clients
                                wss.clients.forEach((client) => {
                                    if (client.readyState === WebSocket.OPEN) {
                                        client.send(JSON.stringify({ type: 'robotstate-update', data: robotstate }));
                                    }
                                });
                                lastRobotStateUpdateTime = currentTime;
                            }
                            
                            if (currentTime - lastRobotStateLoggingTime >= 1000) { // Check if 1 second has passed for logging
                                // console.log('Received and decoded robot state(pose):', robotstate);
                                lastRobotStateLoggingTime = currentTime; // Update last update time for logging
                            }
                        }
                    } catch (e) {
                        console.error('Failed to decode Any message:', e);
                    }
                }
            }
        });

        robotStateStream.on('error', (error) => {
            console.error('Robot state stream error:', error);
            robotStateStream = null;
            // Attempt to reconnect after a delay
            setTimeout(startRobotStateStreaming, 5000);
        });

        robotStateStream.on('end', () => {
            console.log('Robot state stream ended');
            robotStateStream = null;
            // Attempt to reconnect after a delay
            setTimeout(startRobotStateStreaming, 5000);
        });

        console.log('Robot state streaming started');
    } catch (error) {
        console.error('Error creating robot state stream:', error);
        robotStateStream = null;
        // Attempt to reconnect after a delay
        setTimeout(startRobotStateStreaming, 5000);
    }
};

// Start state streaming when server starts
startRobotStateStreaming();

////////////////////////////////////////////////////////////////////////////////
// Operation State streaming setup
let opstateStream = null;
let lastOpStateUpdateTime = 0; // Add this line to track last update time
let lastOpStateLoggingTime = 0; // Add this line to track last logging time

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

                            const currentTime = Date.now();
                            
                            if (currentTime - lastOpStateUpdateTime >= 100) {
                                // Broadcast to all connected WebSocket clients
                                wss.clients.forEach((client) => {
                                    if (client.readyState === WebSocket.OPEN) {
                                        client.send(JSON.stringify({ type: 'opstate-update', data: opstate }));
                                    }
                                });
                                lastOpStateUpdateTime = currentTime; // Update last update time
                            }

                            if (currentTime - lastOpStateLoggingTime >= 1000) { // Check if 1 second has passed for logging
                                console.log('Received and decoded operation state:', { ...opstate, op_mode: `0x${opstate.op_mode.toString(16)}` });
                                lastOpStateLoggingTime = currentTime; // Update last update time for logging
                            }
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