import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import {
    Box,
    Button,
    Container,
    Grid,
    Slider,
    Typography,
    Paper,
    IconButton,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
} from '@mui/material';
import {
    ArrowUpward,
    ArrowDownward,
    ArrowBack,
    ArrowForward,
    PlayArrow,
    Stop,
    RotateLeft,
    RotateRight,
} from '@mui/icons-material';
import axios from 'axios';
import YAML from 'yaml';
import PonyKA from './PonyKA';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';

const API_BASE_URL = 'http://localhost:3001/api';

function App() {
    return (
        <Router>
            <Container maxWidth="md">
                <Box sx={{ my: 4 }}>
                    <nav>
                        <Link to="/">Home</Link> | <Link to="/pony-ka">PonyKA</Link>
                    </nav>
                    <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/pony-ka" element={<PonyKA />} />
                    </Routes>
                </Box>
            </Container>
        </Router>
    );
}

function Home() {
    const [speed, setSpeed] = useState(50);
    const [activeStreams, setActiveStreams] = useState(new Map());
    const [isRunning, setIsRunning] = useState(false);
    const [robotState, setRobotState] = useState({ x: 0, y: 0, theta: 0 });
    const [navState, setNavState] = useState({ x: 0, y: 0, theta: 0 });
    const [navTraj, setNavTraj] = useState([]);
    const [robotPositionHistory, setRobotPositionHistory] = useState([]); // New state for robot position history
    const [currentDirection, setCurrentDirection] = useState(null);

    // Map related states
    const [mapList, setMapList] = useState([]);
    const [selectedMap, setSelectedMap] = useState('');
    const [mapImageUrl, setMapImageUrl] = useState('');
    const [mapResolution, setMapResolution] = useState(0);
    const [mapOrigin, setMapOrigin] = useState([0, 0, 0]);
    const [mapImageDimensions, setMapImageDimensions] = useState({ width: 0, height: 0 });
    const [mapZoom, setMapZoom] = useState(1);

    const handleZoomIn = () => setMapZoom(zoom => Math.min(3.0, zoom + 0.1));
    const handleZoomOut = () => setMapZoom(zoom => Math.max(0.1, zoom - 0.1));
    const handleZoomReset = () => setMapZoom(1);

    useEffect(() => {
        // Fetch map list
        axios.get('/maps/map_list.json')
            .then(response => {
                setMapList(response.data);
                if (response.data.length > 0) {
                    setSelectedMap(response.data[0]);
                }
            })
            .catch(error => console.error('Error fetching map list:', error));
    }, []);

    useEffect(() => {
        // Fetch map image and metadata from selected map YAML
        if (selectedMap) {
            axios.get(`/maps/${selectedMap}`)
                .then(response => {
                    const doc = YAML.parse(response.data);
                    if (doc.image) {
                        setMapImageUrl(`/maps/${doc.image}`);
                    }
                    if (doc.resolution) {
                        setMapResolution(doc.resolution);
                    }
                    if (doc.origin) {
                        setMapOrigin(doc.origin);
                    }
                })
                .catch(error => console.error('Error fetching map YAML:', error));
        }
    }, [selectedMap]);

    const handleImageLoad = (e) => {
        setMapImageDimensions({ width: e.target.naturalWidth, height: e.target.naturalHeight });
    };

    const robotToPixel = (robotX, robotY, robotTheta) => {
        if (!mapResolution || !mapImageDimensions.width || !mapImageDimensions.height) {
            return { x: -100, y: -100, rotation: 0 }; // Return off-screen if map data is not ready
        }

        // Convert robot coordinates to map-relative coordinates (meters)
        // mapOrigin is the real-world coordinate of the bottom-left pixel of the map.
        const robotXRelative = robotX - mapOrigin[0];
        const robotYRelative = robotY - mapOrigin[1];
        const robotThRelative = -robotTheta + mapOrigin[2] * (Math.PI / 180);

        // Convert map-relative coordinates to pixel coordinates (from top-left of image)
        // pixelX is distance from left edge of image.
        // pixelY is distance from top edge of image (Y-axis inverted for image display).
        const pixelX = robotXRelative / mapResolution;
        const pixelY = mapImageDimensions.height - (robotYRelative / mapResolution);

        // Convert theta to degrees for CSS rotation
        const rotation = robotThRelative * (180 / Math.PI);

        return { x: pixelX, y: pixelY, rotation: rotation };
    };

    const { x: robotPixelX, y: robotPixelY, rotation: robotRotation } = robotToPixel(robotState.x, robotState.y, robotState.theta);

    useEffect(() => {
    // console.log(`Robot Pixel Coordinates: X=${robotPixelX.toFixed(2)}, Y=${robotPixelY.toFixed(2)}, Rotation=${robotRotation.toFixed(2)}deg`);

        // Update robot position history
        setRobotPositionHistory(prevHistory => {
            const now = Date.now();
            const newHistory = [...prevHistory, { x: robotState.x, y: robotState.y, timestamp: now }];
            // Keep only data from the last 10 seconds
            return newHistory.filter(pos => now - pos.timestamp < 10000);
        });
    }, [robotPixelX, robotPixelY, robotRotation, robotState.x, robotState.y]);

    useEffect(() => {
        // WebSocket connection
        const websocket = new WebSocket('ws://localhost:3005');

        websocket.onopen = () => {
            console.log('WebSocket Connected');
        };

        websocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'robotstate-update') {
                setRobotState(message.data);
            }
            else if (message.type === 'navstate-update') {
                setNavState(message.data);
            }
            else if (message.type === 'navtraj-update') {
                setNavTraj(message.data);
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

    // Cleanup streams on component unmount
    useEffect(() => {
        return () => {
            activeStreams.forEach((streamId) => {
                cleanupStream(streamId);
            });
        };
    }, [activeStreams]);

    const cleanupStream = async (streamId) => {
        try {
            await axios.delete(`${API_BASE_URL}/stream/${streamId}`);
            setActiveStreams((prev) => {
                const newMap = new Map(prev);
                newMap.delete(streamId);
                return newMap;
            });
        } catch (error) {
            console.error('Error cleaning up stream:', error);
        }
    };

    const sendCommand = async (command) => {
        try {
            const response = await axios.post(`${API_BASE_URL}/command`, { command });
            if (response.data.streamId) {
                setActiveStreams((prev) => {
                    const newMap = new Map(prev);
                    newMap.set(command, response.data.streamId);
                    return newMap;
                });
            }
        } catch (error) {
            console.error('Error sending command:', error);
        }
    };

    const sendMovement = useCallback(async (direction) => {
        if (!direction) return;
        try {
            const response = await axios.post(`${API_BASE_URL}/movement`, {
                speed,
                direction,
            });
            if (response.data.streamId) {
                setActiveStreams((prev) => {
                    const newMap = new Map(prev);
                    newMap.set(`MOVE_${direction}`, response.data.streamId);
                    return newMap;
                });
            }
        } catch (error) {
            console.error('Error sending movement:', error);
        }
    }, [speed]);

    useEffect(() => {
        sendMovement(currentDirection);
    }, [currentDirection, sendMovement]);

    const handleStartStop = () => {
        sendCommand(isRunning ? 'Stop' : 'Start');
        setIsRunning(!isRunning);
        setCurrentDirection(null);
    };

    const handleMovement = (direction) => {
        setCurrentDirection(direction);
    };

    return (
        <Container maxWidth="md">
            <Box sx={{ my: 4 }}>
                <Typography variant="h4" component="h1" gutterBottom align="center">
                    Robot Remote Control
                </Typography>

                {/* Map Display Section */}
                <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Map Display
                    </Typography>
                    <FormControl fullWidth sx={{ mb: 2 }}>
                        <InputLabel id="map-select-label">Select Map</InputLabel>
                        <Select
                            labelId="map-select-label"
                            id="map-select"
                            value={selectedMap}
                            label="Select Map"
                            onChange={(e) => setSelectedMap(e.target.value)}
                        >
                            {mapList.map((mapName) => (
                                <MenuItem key={mapName} value={mapName}>
                                    {mapName}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    {mapImageUrl && (
                        <Box sx={{ mt: 2, position: 'relative' }}>
                            <Box sx={{ overflow: 'auto', maxHeight: '600px' }}>
                                <Box sx={{ position: 'relative', display: 'inline-block', transform: `scale(${mapZoom})`, transformOrigin: 'top left' }}>
                                    <img
                                        src={mapImageUrl}
                                        alt="Selected Map"
                                        onLoad={handleImageLoad}
                                        style={{ display: 'block' }}
                                    />
                                    {mapImageDimensions.width > 0 && mapImageDimensions.height > 0 && (
                                        <>
                                            <svg
                                                width={mapImageDimensions.width}
                                                height={mapImageDimensions.height}
                                                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
                                            >
                                                <polyline
                                                    points={robotPositionHistory.map(pos => {
                                                        const { x, y } = robotToPixel(pos.x, pos.y, 0); // Theta is not needed for path
                                                        return `${x},${y}`;
                                                    }).join(' ')}
                                                    fill="none"
                                                    stroke="blue"
                                                    strokeWidth={2 / mapZoom}
                                                />
                                                <polyline
                                                    points={navTraj.map(pos => {
                                                        const { x, y } = robotToPixel(pos.x, pos.y, 0);
                                                        return `${x},${y}`;
                                                    }).join(' ')}
                                                    fill="none"
                                                    stroke="red"
                                                    strokeWidth={2 / mapZoom}
                                                />
                                            </svg>
                                            <img
                                                src="/images/robot_icon.png" // Path to your robot icon
                                                alt="Robot Icon"
                                                style={{
                                                    position: 'absolute',
                                                    left: robotPixelX,
                                                    top: robotPixelY,
                                                    transform: `translate(-50%, -50%) rotate(${robotRotation}deg)`,
                                                    // width: `${50 / mapZoom}px`,
                                                    // height: `${50 / mapZoom}px`,
                                                    width: `${0.8 / mapResolution}px`,
                                                    height: `${0.8 / mapResolution}px`,
                                                    pointerEvents: 'none'
                                                }}
                                            />
                                        </>
                                    )}
                                </Box>
                            </Box>
                            <Box sx={{ position: 'absolute', top: '10px', right: '10px', zIndex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <IconButton onClick={handleZoomIn} size="small" sx={{ padding: 0 }}>
                                    <img src="/images/zoomin.png" alt="Zoom In" style={{ width: '24px', height: '24px' }} />
                                </IconButton>
                                <IconButton onClick={handleZoomOut} size="small" sx={{ padding: 0 }}>
                                    <img src="/images/zoomout.png" alt="Zoom Out" style={{ width: '24px', height: '24px' }} />
                                </IconButton>
                                <IconButton onClick={handleZoomReset} size="small" sx={{ padding: 0 }}>
                                    <img src="/images/fullscreen.png" alt="Reset Zoom" style={{ width: '24px', height: '24px' }} />
                                </IconButton>
                            </Box>
                        </Box>
                    )}
                </Paper>

                {/* Robot State Display */}
                <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Robot State
                    </Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={4}>
                            <Typography variant="subtitle1">X Position</Typography>
                            <Typography variant="h6">{robotState.x.toFixed(3)}</Typography>
                        </Grid>
                        <Grid item xs={4}>
                            <Typography variant="subtitle1">Y Position</Typography>
                            <Typography variant="h6">{robotState.y.toFixed(3)}</Typography>
                        </Grid>
                        <Grid item xs={4}>
                            <Typography variant="subtitle1">Orientation (θ)</Typography>
                            <Typography variant="h6">{(robotState.theta * 180 / Math.PI).toFixed(1)}°</Typography>
                        </Grid>
                    </Grid>
                </Paper>

                <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Command Buttons
                    </Typography>
                    <Grid container spacing={2} justifyContent="center">
                        {['Sit Up', 'Sit Down', 'E-STOP'].map((command) => (
                            <Grid item key={command}>
                                <Button
                                    variant="contained"
                                    color={command === 'E-STOP' ? 'error' : 'primary'}
                                    onClick={() => sendCommand(command)}
                                >
                                    {command}
                                </Button>
                            </Grid>
                        ))}
                    </Grid>
                </Paper>

                <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Movement Control
                    </Typography>

                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4 }}>
                        {/* Jog Control Area */}
                        <Box sx={{ position: 'relative', width: 400, height: 400 }}>
                            {/* Ring Container */}
                            <Box sx={{
                                position: 'absolute',
                                top: '50%',
                                left: '50%',
                                transform: 'translate(-50%, -50%)',
                                width: 360,
                                height: 360,
                                borderRadius: '50%',
                                border: '4px solid #e0e0e0',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center'
                            }}>
                                {/* Up Button */}
                                <Box sx={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)' }}>
                                    <IconButton
                                        size="large"
                                        onClick={() => handleMovement('forward')}
                                        sx={{
                                            bgcolor: 'primary.main',
                                            color: 'white',
                                            '&:hover': { bgcolor: 'primary.dark' },
                                            width: 80,
                                            height: 80,
                                            fontSize: '2rem'
                                        }}
                                    >
                                        <ArrowUpward fontSize="large" />
                                    </IconButton>
                                </Box>

                                {/* Left Button */}
                                <Box sx={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)' }}>
                                    <IconButton
                                        size="large"
                                        onClick={() => handleMovement('left')}
                                        sx={{
                                            bgcolor: 'primary.main',
                                            color: 'white',
                                            '&:hover': { bgcolor: 'primary.dark' },
                                            width: 80,
                                            height: 80,
                                            fontSize: '2rem'
                                        }}
                                    >
                                        <ArrowBack fontSize="large" />
                                    </IconButton>
                                </Box>

                                {/* Center Start/Stop Button */}
                                <Box sx={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
                                    <IconButton
                                        size="large"
                                        onClick={handleStartStop}
                                        sx={{
                                            bgcolor: isRunning ? 'error.main' : 'success.main',
                                            color: 'white',
                                            '&:hover': { bgcolor: isRunning ? 'error.dark' : 'success.dark' },
                                            width: 100,
                                            height: 100,
                                            fontSize: '2.5rem'
                                        }}
                                    >
                                        {isRunning ? <Stop fontSize="large" /> : <PlayArrow fontSize="large" />}
                                    </IconButton>
                                </Box>

                                {/* Right Button */}
                                <Box sx={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}>
                                    <IconButton
                                        size="large"
                                        onClick={() => handleMovement('right')}
                                        sx={{
                                            bgcolor: 'primary.main',
                                            color: 'white',
                                            '&:hover': { bgcolor: 'primary.dark' },
                                            width: 80,
                                            height: 80,
                                            fontSize: '2rem'
                                        }}
                                    >
                                        <ArrowForward fontSize="large" />
                                    </IconButton>
                                </Box>

                                {/* Down Button */}
                                <Box sx={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)' }}>
                                    <IconButton
                                        size="large"
                                        onClick={() => handleMovement('backward')}
                                        sx={{
                                            bgcolor: 'primary.main',
                                            color: 'white',
                                            '&:hover': { bgcolor: 'primary.dark' },
                                            width: 80,
                                            height: 80,
                                            fontSize: '2rem'
                                        }}
                                    >
                                        <ArrowDownward fontSize="large" />
                                    </IconButton>
                                </Box>

                                {/* Left Rotation Button */}
                                <Box sx={{
                                    position: 'absolute',
                                    left: '50%',
                                    top: '50%',
                                    transform: 'translate(-50%, -50%) rotate(-45deg) translateY(-180px) rotate(45deg)'
                                }}>
                                    <IconButton
                                        size="large"
                                        onClick={() => handleMovement('rotate_left')}
                                        sx={{
                                            bgcolor: 'secondary.main',
                                            color: 'white',
                                            '&:hover': { bgcolor: 'secondary.dark' },
                                            width: 80,
                                            height: 80,
                                            fontSize: '2rem'
                                        }}
                                    >
                                        <RotateLeft fontSize="large" />
                                    </IconButton>
                                </Box>

                                {/* Right Rotation Button */}
                                <Box sx={{
                                    position: 'absolute',
                                    left: '50%',
                                    top: '50%',
                                    transform: 'translate(-50%, -50%) rotate(45deg) translateY(-180px) rotate(-45deg)'
                                }}>
                                    <IconButton
                                        size="large"
                                        onClick={() => handleMovement('rotate_right')}
                                        sx={{
                                            bgcolor: 'secondary.main',
                                            color: 'white',
                                            '&:hover': { bgcolor: 'secondary.dark' },
                                            width: 80,
                                            height: 80,
                                            fontSize: '2rem'
                                        }}
                                    >
                                        <RotateRight fontSize="large" />
                                    </IconButton>
                                </Box>
                            </Box>
                        </Box>

                        {/* Speed Control */}
                        <Box sx={{ height: 400, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <Typography gutterBottom>Speed</Typography>
                            <Slider
                                sx={{
                                    '& input[type="range"]': {
                                        WebkitAppearance: 'slider-vertical',
                                    },
                                    height: 400,
                                    '& .MuiSlider-thumb': {
                                        marginLeft: '-8px',
                                    },
                                }}
                                orientation="vertical"
                                value={speed}
                                onChange={(_, newValue) => setSpeed(newValue)}
                                min={0}
                                max={100}
                                valueLabelDisplay="auto"
                            />
                        </Box>
                    </Box>
                </Paper>
            </Box>
        </Container>
    );
}

export default App;