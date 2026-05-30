require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const games = new Map();

app.use(express.json());
app.use(express.static('public')); // For frontend files

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
})

// Create a new game room
app.post('/create-game', (req, res) => {
    const roomId = generateRoomCode();
    console.log("room created")
    games.set(roomId, {
        id: roomId,
        players: new Map(),
        usernames: {},
        positions: {}
    });
    res.json({ roomId });
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    const urlParams = new URL(req.url, `http://${req.headers.host}`);
    const roomId = urlParams.searchParams.get('roomId');
    const playerId = urlParams.searchParams.get('playerId');
    const playerUser = urlParams.searchParams.get('user');
    
    if (!roomId || !playerId) {
        ws.close();
        return;
    }
    
    const game = games.get(roomId);
    if (!game) {
        ws.send(JSON.stringify({ type: 'game_not_found' }));
        ws.close();
        return;
    }
    
    // Store player connection
    game.players.set(playerId, ws);
    
    // Initialize player information
    game.positions[playerId] = { x: 0, y: 0 };
    game.usernames[playerId] = playerUser;
    
    console.log(`Player ${playerUser} joined room ${roomId}`);
    
    // Notify other player that someone joined
    game.players.forEach((oWs, otherId) => {
        if (otherId !== playerId) {
            oWs.send(JSON.stringify({ 
                type: 'opponent_joined', 
                playerId: playerId,
                user: playerUser
            }));
        }
    });
    
    // Send current game state to new player
    ws.send(JSON.stringify({
        type: 'game_state',
        positions: game.positions,
        users: game.usernames
    }));
    
    // Handle incoming messages
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            const game = games.get(roomId);
            
            if (!game) return;
            
            switch (message.type) {
                case 'position_update':
                    game.positions[playerId] = message.position;
                    
                    // Broadcast to other player only
                    for (let [otherId, otherWs] of game.players) {
                        // if (otherId !== playerId && otherWs.readyState === WebSocket.OPEN) {
                        if (otherWs.readyState === WebSocket.OPEN) {
                            otherWs.send(JSON.stringify({
                                type: 'position_update',
                                playerId: playerId,
                                position: message.position
                            }));
                        }
                    }
                    break;
                    
                case 'get_positions':
                    ws.send(JSON.stringify({
                        type: 'positions',
                        positions: game.positions
                    }));
                    break;
            }
        } catch (err) {
            console.error('Error parsing message:', err);
        }
    });
    
    // Handle player disconnect
    ws.on('close', () => {
        const game = games.get(roomId);
        if (game) {
            game.players.delete(playerId);
            delete game.positions[playerId];
            delete game.usernames[playerId];
            
            // Notify other player
            for (let [otherId, otherWs] of game.players) {
                if (otherWs.readyState === WebSocket.OPEN) {
                    otherWs.send(JSON.stringify({
                        type: 'player_disconnected',
                        playerId: playerId
                    }));
                }
            }
            
            // Clean up empty games
            if (game.players.size === 0) {
                games.delete(roomId);
            }
        }
        console.log(`Player ${playerId} disconnected`);
    });
});

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const PORT = 3000
server.listen(PORT, () => {
    console.log(`Client available at port ${PORT}`);
    console.log(`Server running on port ${PORT}`); 
});