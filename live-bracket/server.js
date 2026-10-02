const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Application State
let tournamentState = {
    status: 'SETUP', // 'SETUP', 'IN_PROGRESS'
    players: [],
    matches: [] // { side, round, index, winningSlotIndex, winnerName }
};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Send current state to newly connected client
    socket.emit('sync_state', tournamentState);

    socket.on('start_tournament', (players) => {
        tournamentState.status = 'IN_PROGRESS';
        tournamentState.players = players;
        tournamentState.matches = [];
        io.emit('tournament_started', players);
    });

    socket.on('resolve_match', (data) => {
        // data: { side, round, index, winningSlotIndex, winnerName }
        const alreadyResolved = tournamentState.matches.find(m => 
            m.side === data.side && m.round === data.round && m.index === data.index
        );
        if (!alreadyResolved) {
            tournamentState.matches.push(data);
            io.emit('match_resolved', data);
        }
    });

    socket.on('reset_tournament', () => {
        tournamentState = {
            status: 'SETUP',
            players: [],
            matches: []
        };
        io.emit('tournament_reset');
    });

    socket.on('edit_players', () => {
        tournamentState.status = 'SETUP';
        io.emit('tournament_edit');
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
