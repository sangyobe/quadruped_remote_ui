import React, { useState, useEffect } from 'react';
import {
    Box,
    Button,
    Container,
    Grid,
    Typography,
    Paper,
    TextField,
} from '@mui/material';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:3001/api';

function PonyKA() {
    const [opState, setOpState] = useState({ op_mode: 0, op_status: 0 });
    const [cmdMode, setCmdMode] = useState(0);
    const [arg, setArg] = useState('');
    const [argN, setArgN] = useState([0, 0, 0]);
    const [argF, setArgF] = useState([0, 0, 0]);
    const [commandResult, setCommandResult] = useState('');

    const handleArgNChange = (index, value) => {
        const newArgN = [...argN];
        newArgN[index] = value;
        setArgN(newArgN);
    };

    const handleArgFChange = (index, value) => {
        const newArgF = [...argF];
        newArgF[index] = value;
        setArgF(newArgF);
    };

    const sendRobotCommand = async () => {
        try {
            const response = await axios.post(`${API_BASE_URL}/sendRobotCommand`, {
                cmd_mode: cmdMode,
                arg: arg,
                arg_n: argN,
                arg_f: argF,
            });
            setCommandResult(JSON.stringify(response.data, null, 2));
        } catch (error) {
            console.error('Error sending robot command:', error);
            setCommandResult(`Error: ${error.message}`);
        }
    };

    const handlePredefinedCommand = (command) => {
        setCmdMode(command.cmd_mode);
        setArg(command.arg);
        setArgN(command.arg_n);
        setArgF(command.arg_f);
    };

    useEffect(() => {
        // WebSocket connection
        const websocket = new WebSocket('ws://localhost:3005');

        websocket.onopen = () => {
            console.log('WebSocket Connected');
        };

        websocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'opstate-update') {
                setOpState(message.data);
            }
        };

        websocket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        websocket.onclose = () => {
            console.log('WebSocket disconnected');
        };

        return () => {
            websocket.close();
        };
    }, []);

    return (
        <Container maxWidth="md">
            <Box sx={{ my: 4 }}>
                <Typography variant="h4" component="h1" gutterBottom align="center">
                    PonyKA Control
                </Typography>

                {/* Operation State Display */}
                <Paper elevation={3} sx={{ p: 3, mt: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Operation State
                    </Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={6}>
                            <TextField
                                label="Operation Mode"
                                value={opState.op_mode}
                                InputProps={{
                                    readOnly: true,
                                }}
                                variant="filled"
                                fullWidth
                            />
                        </Grid>
                        <Grid item xs={6}>
                            <TextField
                                label="Operation Status"
                                value={opState.op_status}
                                InputProps={{
                                    readOnly: true,
                                }}
                                variant="filled"
                                fullWidth
                            />
                        </Grid>
                    </Grid>
                </Paper>

                {/* Robot Command Sender */}
                <Paper elevation={3} sx={{ p: 3, mt: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Send Robot Command
                    </Typography>
                    <Grid container spacing={2} alignItems="center">
                        <Grid item xs={12}>
                            <TextField
                                label="Command Mode"
                                type="number"
                                value={cmdMode}
                                onChange={(e) => setCmdMode(e.target.value)}
                                fullWidth
                                margin="normal"
                            />
                        </Grid>
                        <Grid item xs={12}>
                            <TextField
                                label="Arg (string)"
                                type="text"
                                value={arg}
                                onChange={(e) => setArg(e.target.value)}
                                fullWidth
                                margin="normal"
                            />
                        </Grid>
                        {[0, 1, 2].map((index) => (
                            <Grid item xs={4} key={`arg_n_${index}`}>
                                <TextField
                                    label={`arg_n[${index}]`}
                                    type="number"
                                    value={argN[index]}
                                    onChange={(e) => handleArgNChange(index, e.target.value)}
                                    fullWidth
                                    margin="normal"
                                />
                            </Grid>
                        ))}
                        {[0, 1, 2].map((index) => (
                            <Grid item xs={4} key={`arg_f_${index}`}>
                                <TextField
                                    label={`arg_f[${index}]`}
                                    type="number"
                                    value={argF[index]}
                                    onChange={(e) => handleArgFChange(index, e.target.value)}
                                    fullWidth
                                    margin="normal"
                                />
                            </Grid>
                        ))}
                        <Grid item xs={12}>
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={sendRobotCommand}
                                fullWidth
                            >
                                Send Robot Command
                            </Button>
                        </Grid>
                        <Grid item xs={12}>
                            <TextField
                                label="Command Result"
                                value={commandResult}
                                InputProps={{
                                    readOnly: true,
                                }}
                                variant="filled"
                                fullWidth
                                margin="normal"
                                multiline
                                rows={4}
                            />
                        </Grid>
                    </Grid>
                </Paper>

                {/* Pre-defined Robot Commands */}
                <Paper elevation={3} sx={{ p: 3, mt: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Pre-defined Robot Commands
                    </Typography>
                    <Grid container spacing={2} justifyContent="center">
                        {[
                            {
                                label: "Ready",
                                cmd_mode: 1,
                                arg: "",
                                arg_n: [1, 0, 0],
                                arg_f: [0.0, 0.0, 0.0],
                            },
                            {
                                label: "Opening",
                                cmd_mode: 1,
                                arg: "",
                                arg_n: [2, 0, 0],
                                arg_f: [0.0, 0.0, 0.0],
                            },
                            {
                                label: "Switch Hands",
                                cmd_mode: 1,
                                arg: "",
                                arg_n: [3, 0, 0],
                                arg_f: [0.0, 0.0, 0.0],
                            },
                            {
                                label: "Throw R",
                                cmd_mode: 1,
                                arg: "",
                                arg_n: [4, 1, 0],
                                arg_f: [0.0, 0.0, 0.0],
                            },
                            {
                                label: "Throw L",
                                cmd_mode: 1,
                                arg: "",
                                arg_n: [4, 2, 0],
                                arg_f: [0.0, 0.0, 0.0],
                            },
                            {
                                label: "Move to door",
                                cmd_mode: 2,
                                arg: "door",
                                arg_n: [1, 0, 0],
                                arg_f: [0.0, 0.0, 0.0],
                            },
                            {
                                label: "Move to site",
                                cmd_mode: 2,
                                arg: "site",
                                arg_n: [1, 0, 0],
                                arg_f: [0.0, 0.0, 0.0],
                            },
                            {
                                label: "Move to table",
                                cmd_mode: 2,
                                arg: "table",
                                arg_n: [1, 0, 0],
                                arg_f: [0.0, 0.0, 0.0],
                            },
                            {
                                label: "Move to (x,y,th)",
                                cmd_mode: 2,
                                arg: "",
                                arg_n: [2, 0, 0],
                                arg_f: [0.0, 0.0, 0.0],
                            },
                            {
                                label: "Grasp",
                                cmd_mode: 3,
                                arg: "",
                                arg_n: [4, 7, 0],
                                arg_f: [0.0, 0.0, 0.0],
                            },
                            {
                                label: "Open door",
                                cmd_mode: 4,
                                arg: "",
                                arg_n: [0, 0, 0],
                                arg_f: [0.0, 0.0, 0.0],
                            },
                            {
                                label: "Pause",
                                cmd_mode: 5,
                                arg: "",
                                arg_n: [1, 0, 0],
                                arg_f: [0.0, 0.0, 0.0],
                            },
                            {
                                label: "Resume",
                                cmd_mode: 5,
                                arg: "",
                                arg_n: [2, 0, 0],
                                arg_f: [0.0, 0.0, 0.0],
                            },
                            {
                                label: "Cancel",
                                cmd_mode: 5,
                                arg: "",
                                arg_n: [3, 0, 0],
                                arg_f: [0.0, 0.0, 0.0],
                            },
                        ].map((command) => (
                            <Grid item key={command.label}>
                                <Button
                                    variant="contained"
                                    color="secondary"
                                    onClick={() => handlePredefinedCommand(command)}
                                >
                                    {command.label}
                                </Button>
                            </Grid>
                        ))}
                    </Grid>
                </Paper>
            </Box>
        </Container>
    );
}

export default PonyKA;