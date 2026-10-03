document.addEventListener("DOMContentLoaded", () => {
  const socket = typeof window.io === "function" ? window.io() : null;
  const STORAGE_KEY = "cr-tournament-state-v1";
  let localMatches = [];

  function emit(event, data) {
    if (socket) {
      socket.emit(event, data);
      return;
    }
    if (event === "start_tournament") {
      players = data;
      localMatches = [];
      setupScreen.classList.add("hidden");
      bracketScreen.classList.remove("hidden");
      buildBracket();
      saveLocalState();
    } else if (event === "resolve_match") {
      const exists = localMatches.some(m => m.side === data.side && m.round === data.round && m.index === data.index);
      if (!exists) {
        localMatches.push(data);
        resolveMatchLocally(data.side, data.round, data.index, data.winningSlotIndex, data.winnerName);
        saveLocalState();
      }
    } else if (event === "reset_tournament") {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    } else if (event === "edit_players") {
      localMatches = [];
      bracketScreen.classList.add("hidden");
      setupScreen.classList.remove("hidden");
      saveLocalState();
    }
  }

  function on(event, handler) {
    if (socket) socket.on(event, handler);
  }

  function saveLocalState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      status: bracketScreen.classList.contains("hidden") ? "SETUP" : "IN_PROGRESS",
      players,
      matches: localMatches
    }));
  }

  function restoreLocalState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);
      players = Array.isArray(state.players) ? state.players : [];
      localMatches = Array.isArray(state.matches) ? state.matches : [];

      if (state.status === "IN_PROGRESS" && players.length === 16) {
        setupScreen.classList.add("hidden");
        bracketScreen.classList.remove("hidden");
        buildBracket();
        const original = animateLine;
        animateLine = (id, cb) => cb && cb();
        localMatches.forEach(m => resolveMatchLocally(m.side, m.round, m.index, m.winningSlotIndex, m.winnerName));
        animateLine = original;
        setTimeout(drawLines, 100);
      } else {
        players.forEach((name, i) => {
          const input = document.getElementById(`p${i + 1}`);
          if (input) input.value = name;
        });
      }
    } catch (error) {
      console.warn("Could not restore tournament state:", error);
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const inputsGrid = document.getElementById("inputs-grid");
  const setupScreen = document.getElementById("setup-screen");
  const bracketScreen = document.getElementById("bracket-screen");
  const svgLayer = document.getElementById("lines-layer");
  
  let players = [];
  const connectionPaths = []; 
  const animatedLines = new Set(); 
  
  for(let i=1; i<=16; i++) {
    const group = document.createElement("div");
    group.className = "input-group";
    group.innerHTML = `<label>Seed ${i}</label><input type="text" id="p${i}" placeholder="Player ${i}" maxlength="20">`;
    inputsGrid.appendChild(group);
  }

  document.getElementById("btn-fill").addEventListener("click", () => {
    const names = ["OJ", "Surgical Goblin", "Morten", "B-rad", "Mohamed Light", "Mugi", "Pompeyo", "Chief Pat", "Ash", "SirTag", "Boss", "ErnieC3", "Kashman", "Lex", "Vulkan", "ClashWithZane"];
    for(let i=1; i<=16; i++) document.getElementById(`p${i}`).value = names[i-1] || `Player ${i}`;
  });

  document.getElementById("btn-reset").addEventListener("click", () => {
    const confirmed = confirm("Reset the tournament and return to player setup? This will clear the current match progress.");
    if (confirmed) emit("reset_tournament");
  });

  document.getElementById("btn-start").addEventListener("click", () => {
    let newPlayers = [];
    for(let i=1; i<=16; i++) {
      const val = document.getElementById(`p${i}`).value.trim();
      if(!val) return alert("You must summon all 16 players to begin the tournament!");
      newPlayers.push(val);
    }
    emit('start_tournament', newPlayers);
  });

  function adaptTeamSizing() {
    const wrapper = document.getElementById("bracket-wrapper");
    if (!wrapper || !players.length) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const longestName = players.reduce((longest, name) =>
      String(name || "").length > String(longest || "").length ? name : longest, ""
    );

    ctx.font = "900 19px 'Trebuchet MS', 'Arial Rounded MT Bold', Arial, sans-serif";
    const longestText = String(longestName || "");
    const measured = Math.ceil(
      ctx.measureText(longestText).width + longestText.length * 0.9
    ) + 8;

    // Every card uses the same width, sized from the longest player name.
    // The cap keeps the seven-column bracket inside the desktop viewport.
    const viewportCap = Math.max(150, Math.floor((wrapper.clientWidth - 12) / 7));
    const teamWidth = Math.min(Math.max(150, measured + 64), Math.min(220, viewportCap));

    // If an exceptionally long name reaches the width cap, reduce the text
    // rather than letting it clip or push the crown out of the card.
    // Reserve room for the crown, card padding, and a small safety margin.
    // This keeps even the longest name fully visible inside the shared card.
    const usableTextWidth = Math.max(90, teamWidth - 78);
    const fontSize = Math.max(
      16,
      Math.min(19, 19 * usableTextWidth / Math.max(measured - 8, 1))
    );
    const crownSize = Math.max(29, Math.min(34, fontSize * 1.72));

    wrapper.style.setProperty("--team-width", teamWidth + "px");
    wrapper.style.setProperty("--name-font-size", fontSize.toFixed(2) + "px");
    wrapper.style.setProperty("--crown-size", crownSize.toFixed(2) + "px");
  }

  function buildBracket() {
    ['L-1','L-2','L-3','C-4','R-3','R-2','R-1'].forEach(id => document.getElementById(`col-${id}`).innerHTML = '');
    connectionPaths.length = 0;
    animatedLines.clear();
    document.getElementById("champion-splash").classList.remove("show");
    
    const leftSeeds = [[0,1], [2,3], [4,5], [6,7]]; 
    const rightSeeds = [[15,14], [13,12], [11,10], [9,8]];

    leftSeeds.forEach((seeds, idx) => createMatch('L', 1, idx, players[seeds[0]], players[seeds[1]]));
    rightSeeds.forEach((seeds, idx) => createMatch('R', 1, idx, players[seeds[0]], players[seeds[1]]));
    
    for(let idx=0; idx<2; idx++) {
      createMatch('L', 2, idx, null, null);
      createMatch('R', 2, idx, null, null);
    }
    createMatch('L', 3, 0, null, null);
    createMatch('R', 3, 0, null, null);
    
    createMatch('C', 4, 0, null, null, true);
    
    registerConnections();
    adaptTeamSizing();
    setTimeout(drawLines, 150);
    updateCurrentRound();
  }

  function updateCurrentRound() {
    const splash = document.getElementById("champion-splash");
    const rounds = [1, 2, 3, 4];

    let activeRound = 5;

    if (!(splash && splash.classList.contains("show"))) {
      for (const round of rounds) {
        const readyMatches = document.querySelectorAll(
          `.match.ready[id^="m-L-${round}-"], .match.ready[id^="m-R-${round}-"], .match.ready[id^="m-C-${round}-"]`
        );
        if (readyMatches.length > 0) {
          activeRound = round;
          break;
        }
      }
    }

    document.querySelectorAll(".col").forEach(col => {
      const match = col.id.match(/-(\\d+)$/);
      if (!match) return;

      const round = Number(match[1]);
      col.classList.remove("round-active", "round-completed", "round-future");

      if (round < activeRound) {
        col.classList.add("round-completed");
      } else if (round === activeRound) {
        col.classList.add("round-active");
      } else {
        col.classList.add("round-future");
      }
    });
  }

  function createMatch(side, round, index, p1, p2, isFinal=false) {
    const col = document.getElementById(`col-${side}-${round}`);
    const match = document.createElement("div");
    match.className = "match";
    if(p1 && p2) match.classList.add("ready"); 
    match.id = `m-${side}-${round}-${index}`;
    
    const teamTop = createTeamElement(side, round, index, 0, p1);
    const teamBot = createTeamElement(side, round, index, 1, p2);
    
    match.appendChild(teamTop);
    match.appendChild(teamBot);
    col.appendChild(match);
  }

  function createTeamElement(side, round, index, slot, name) {
    const div = document.createElement("div");
    div.className = "team " + (name ? "" : "team-empty");
    div.id = `t-${side}-${round}-${index}-${slot}`;
    
    const crown = document.createElement("img");
    crown.className = "crown-icon";
    crown.src = "crown.svg";
    crown.alt = "";
    // Keep the badge in the flex layout from the start; CSS collapses it
    // until the match has a winner, allowing a smooth reveal without
    // disturbing the centered name before selection.
    
    const nameSpan = document.createElement("span");
    nameSpan.className = "player-name";
    nameSpan.textContent = name || "Waiting...";
    
    div.appendChild(crown);
    div.appendChild(nameSpan);
    
    div.addEventListener("click", function() {
      const parentMatch = document.getElementById(`m-${side}-${round}-${index}`);
      if (!parentMatch.classList.contains("ready") || parentMatch.classList.contains("resolved")) return;
      
      emit('resolve_match', {
        side, round, index, winningSlotIndex: slot, winnerName: nameSpan.textContent
      });
    });
    
    return div;
  }

  function resolveMatchLocally(side, round, index, winningSlotIndex, winnerName) {
    const match = document.getElementById(`m-${side}-${round}-${index}`);
    if (!match) return; // Bracket might not be built yet
    match.classList.remove("ready");
    match.classList.add("resolved");
    
    const wTeam = document.getElementById(`t-${side}-${round}-${index}-${winningSlotIndex}`);
    const lTeam = document.getElementById(`t-${side}-${round}-${index}-${1 - winningSlotIndex}`);
    if(wTeam) {
      wTeam.classList.add("winner");
      const winnerCrown = wTeam.querySelector(".crown-icon");
      if (winnerCrown) winnerCrown.style.display = "block";
    }
    if(lTeam) {
      lTeam.classList.add("loser");
      const loserCrown = lTeam.querySelector(".crown-icon");
      if (loserCrown) loserCrown.style.display = "none";
    }

    if (round === 4) {
      celebrateChampion(winnerName);
      return;
    }

    let nextRound = round + 1;
    let nextSide = side;
    let nextIndex = Math.floor(index / 2);
    let nextSlot = index % 2;
    
    if (round === 3) {
      nextSide = 'C';
      nextIndex = 0;
      nextSlot = (side === 'L' ? 0 : 1);
    }

    const connectionId = `${side}-${round}-${index}`;
    animateLine(connectionId, () => {
      const targetTeam = document.getElementById(`t-${nextSide}-${nextRound}-${nextIndex}-${nextSlot}`);
      if (!targetTeam) return;
      targetTeam.querySelector('.player-name').textContent = winnerName;
      targetTeam.classList.remove("team-empty");
      
      targetTeam.classList.add("pop-in");
      setTimeout(() => targetTeam.classList.remove("pop-in"), 500);

      const nextMatch = document.getElementById(`m-${nextSide}-${nextRound}-${nextIndex}`);
      if (nextMatch) {
          const t1 = document.getElementById(`t-${nextSide}-${nextRound}-${nextIndex}-0`);
          const t2 = document.getElementById(`t-${nextSide}-${nextRound}-${nextIndex}-1`);
          
          if (!t1.classList.contains("team-empty") && !t2.classList.contains("team-empty")) {
            nextMatch.classList.add("ready");
          }
      }
      updateCurrentRound();
    });
  }

  function celebrateChampion(name) {
    const splash = document.getElementById("champion-splash");
    document.getElementById("champion-name").textContent = name;
    splash.classList.add("show");
    updateCurrentRound();
  }

  function registerConnections() {
    for(let r=1; r<=2; r++) {
      const matchCount = (r === 1) ? 4 : 2;
      for(let i=0; i<matchCount; i++) {
        connectionPaths.push({ id: `L-${r}-${i}`, sourceMatch: `m-L-${r}-${i}`, targetTeam: `t-L-${r+1}-${Math.floor(i/2)}-${i%2}`, direction: 'right' });
        connectionPaths.push({ id: `R-${r}-${i}`, sourceMatch: `m-R-${r}-${i}`, targetTeam: `t-R-${r+1}-${Math.floor(i/2)}-${i%2}`, direction: 'left' });
      }
    }
    connectionPaths.push({ id: `L-3-0`, sourceMatch: `m-L-3-0`, targetTeam: `t-C-4-0-0`, direction: 'right' });
    connectionPaths.push({ id: `R-3-0`, sourceMatch: `m-R-3-0`, targetTeam: `t-C-4-0-1`, direction: 'left' });
  }

  function drawLines() {
    svgLayer.innerHTML = '';
    const wrapperRect = document.getElementById("bracket-wrapper").getBoundingClientRect();
    
    connectionPaths.forEach(conn => {
      const sourceEl = document.getElementById(conn.sourceMatch);
      const targetEl = document.getElementById(conn.targetTeam);
      if(!sourceEl || !targetEl) return;
      
      const sRect = sourceEl.getBoundingClientRect();
      const tRect = targetEl.getBoundingClientRect();
      
      let x1, y1, x2, y2;
      
      if(conn.direction === 'right') {
        x1 = sRect.right - wrapperRect.left;
        y1 = sRect.top + sRect.height/2 - wrapperRect.top;
        x2 = tRect.left - wrapperRect.left;
        y2 = tRect.top + tRect.height/2 - wrapperRect.top;
      } else {
        x1 = sRect.left - wrapperRect.left;
        y1 = sRect.top + sRect.height/2 - wrapperRect.top;
        x2 = tRect.right - wrapperRect.left;
        y2 = tRect.top + tRect.height/2 - wrapperRect.top;
      }
      
      const offset = (conn.direction === 'right') ? 50 : -50;
      const d = `M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 - offset} ${y2}, ${x2} ${y2}`;
      
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "line");
      path.id = `path-${conn.id}`;
      svgLayer.appendChild(path);

      if(animatedLines.has(conn.id)) {
        drawActiveLineStatic(d, conn.id);
      }
    });
  }

  let originalAnimateLine = animateLine;

  function animateLine(connectionId, callback) {
    const basePath = document.getElementById(`path-${connectionId}`);
    if(!basePath) { if(callback) callback(); return; }
    
    const d = basePath.getAttribute("d");
    const activePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    activePath.setAttribute("d", d);
    activePath.setAttribute("class", "line-active");
    
    svgLayer.appendChild(activePath);
    animatedLines.add(connectionId);
    
    // Let the browser paint the active path first, then advance on the next
    // frame instead of forcing a long timer-based animation pause.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (callback) callback();
      });
    });
  }

  function drawActiveLineStatic(d, connectionId) {
    const activePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    activePath.setAttribute("d", d);
    activePath.setAttribute("class", "line-active");
    svgLayer.appendChild(activePath);
  }

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    if (bracketScreen.classList.contains("hidden") || resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      adaptTeamSizing();
      drawLines();
    });
  });

  // Realtime server handlers are used when the Node server is running.
  // GitHub Pages falls back to browser-local persistence.

  on('sync_state', (state) => {
    players = state.players;
    if (state.status === 'SETUP') {
        setupScreen.classList.remove("hidden");
        bracketScreen.classList.add("hidden");
        for (let i=0; i<players.length; i++) {
            const input = document.getElementById(`p${i+1}`);
            if (input) input.value = players[i];
        }
    } else if (state.status === 'IN_PROGRESS') {
        setupScreen.classList.add("hidden");
        bracketScreen.classList.remove("hidden");
        buildBracket();
        
        let oldAnimateLine = animateLine;
        animateLine = (id, cb) => cb && cb(); 
        
        state.matches.forEach(m => {
            resolveMatchLocally(m.side, m.round, m.index, m.winningSlotIndex, m.winnerName);
        });

        animateLine = oldAnimateLine;
        setTimeout(drawLines, 100); // redraw active lines
    }
  });

  on('tournament_started', (newPlayers) => {
    players = newPlayers;
    setupScreen.classList.add("hidden");
    bracketScreen.classList.remove("hidden");
    buildBracket();
  });

  on('match_resolved', (data) => {
    resolveMatchLocally(data.side, data.round, data.index, data.winningSlotIndex, data.winnerName);
  });

  on('tournament_reset', () => {
    location.reload();
  });

  on('tournament_edit', () => {
    bracketScreen.classList.add("hidden");
    setupScreen.classList.remove("hidden");
  });


  if (!socket) restoreLocalState();
});
