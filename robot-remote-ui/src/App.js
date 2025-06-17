import React, { useState, useEffect } from 'react';
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

const API_BASE_URL = 'http://localhost:3001/api';

function App() {
  const [speed, setSpeed] = useState(50);
  const [activeStreams, setActiveStreams] = useState(new Map());
  const [isRunning, setIsRunning] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [robotState, setRobotState] = useState({ x: 0, y: 0, theta: 0 });
  const [ws, setWs] = useState(null);
  const [currentDirection, setCurrentDirection] = useState(null);

  useEffect(() => {
    // WebSocket connection
    const websocket = new WebSocket('ws://localhost:3005');

    websocket.onopen = () => {
      console.log('WebSocket Connected');
    };

    websocket.onmessage = (event) => {
      const state = JSON.parse(event.data);
      setRobotState(state);
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    websocket.onclose = () => {
      console.log('WebSocket disconnected');
    };

    setWs(websocket);

    return () => {
      websocket.close();
    };
  }, []);

  // Effect to handle speed changes
  useEffect(() => {
    if (currentDirection) {
      sendMovement(currentDirection);
    }
  }, [speed]);

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

  const sendMovement = async (direction) => {
    try {
      setCurrentDirection(direction);
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
  };

  const handleStartStop = () => {
    sendCommand(isRunning ? 'Stop' : 'Start');
    setIsRunning(!isRunning);
    setCurrentDirection(null);
  };

  const handleMovement = async (direction) => {
    await sendMovement(direction);
  };

  const handleStop = () => {
    handleStartStop();
  };

  const handleCommand = async () => {
    await handleStartStop();
  };

  return (
    <Container maxWidth="md">
      <Box sx={{ my: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom align="center">
          Robot Remote Control
        </Typography>

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

        {/* Robot State Display */}
        <Paper elevation={3} sx={{ p: 3 }}>
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
      </Box>
    </Container>
  );
}

export default App; 