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
    if (!confirmed) return;

    const audio = document.getElementById("champion-victory-audio");
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    const splash = document.getElementById("champion-splash");
    if (splash) {
      splash.classList.remove("show");
      splash.setAttribute("aria-hidden", "true");
    }

    emit("reset_tournament");
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

    // Keep every name card identical. Long player names wrap inside the
    // fixed card instead of changing the card dimensions.
    const viewportCap = Math.max(150, Math.floor((wrapper.clientWidth - 12) / 7));
    const teamWidth = Math.min(212, viewportCap);

    wrapper.style.setProperty("--team-width", teamWidth + "px");
    wrapper.style.setProperty("--name-font-size", "17px");
    wrapper.style.setProperty("--crown-size", "40px");

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    wrapper.querySelectorAll(".team .player-name").forEach((nameNode) => {
      const team = nameNode.closest(".team");
      if (!team || team.classList.contains("team-empty")) {
        nameNode.style.removeProperty("font-size");
        return;
      }

      const text = String(nameNode.textContent || "");
      const isWinner = team.classList.contains("winner");
      const available = Math.max(72, teamWidth - 24 - (isWinner ? 47 : 0));

      let size = 17;
      if (ctx && text) {
        ctx.font = "19px 'You Blockhead', sans-serif";
        const width = ctx.measureText(text).width + text.length * 0.15;

        // Names that need wrapping use a deliberately smaller size.
        // Normal-length names remain at the full 19px size.
        if (width > available) {
          size = 15;

          // Give exceptionally long names a little more reduction.
          if (width > available * 1.55) {
            size = Math.max(13, 15 * available / width);
          }
        }
      }

      nameNode.style.setProperty("font-size", size.toFixed(2) + "px", "important");
    });
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
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => adaptTeamSizing());
    }
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

  function shapeChampionName(name) {
    const node = document.getElementById("champion-name");
    if (!node) return;

    const text = String(name || "");
    node.dataset.championName = text;

    if (node._championName3DCleanup) {
      node._championName3DCleanup();
      node._championName3DCleanup = null;
    }

    node.innerHTML = "";

    const chars = Array.from(text);
    if (!chars.length) return;

    /*
     * ribbon.png is raster artwork, not a Three.js/parametric mesh. The
     * previous CSS matrix3d implementation still looked like a 2D arc.
     * The champion name is now rendered as real WebGL geometry:
     * each glyph is a textured quad placed on one continuous 3D bowed
     * surface, with a 3D tangent, surface normal, local normal offset,
     * perspective projection, and arc-length placement.
     */
    const ribbon = document.querySelector(".champion-ribbon img");
    const ribbonRect = ribbon
      ? ribbon.getBoundingClientRect()
      : {
          left: window.innerWidth * 0.12,
          top: window.innerHeight * 0.55,
          width: window.innerWidth * 0.76,
          height: window.innerHeight * 0.22
        };

    const canvas = document.createElement("canvas");
    canvas.className = "champion-name-webgl";
    canvas.setAttribute("aria-hidden", "true");
    node.appendChild(canvas);

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false
    }) || canvas.getContext("experimental-webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false
    });

    if (!gl) {
      const fallback = document.createElement("span");
      fallback.className = "champion-name-webgl-fallback";
      fallback.textContent = text;
      node.appendChild(fallback);
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    canvas.width = Math.max(1, Math.round(viewportWidth * dpr));
    canvas.height = Math.max(1, Math.round(viewportHeight * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);

    const vertexShaderSource = [
      "attribute vec3 aPosition;",
      "attribute vec2 aUv;",
      "uniform mat4 uProjectionView;",
      "uniform mat4 uModel;",
      "varying vec2 vUv;",
      "void main() {",
      "  vUv = aUv;",
      "  gl_Position = uProjectionView * uModel * vec4(aPosition, 1.0);",
      "}"
    ].join("\n");

    const fragmentShaderSource = [
      "precision mediump float;",
      "uniform sampler2D uTexture;",
      "varying vec2 vUv;",
      "void main() {",
      "  vec4 color = texture2D(uTexture, vUv);",
      "  if (color.a < 0.01) discard;",
      "  gl_FragColor = color;",
      "}"
    ].join("\n");

    function compileShader(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error("Champion name shader compile failed: " + (log || "unknown error"));
      }
      return shader;
    }

    function createProgram(vertexSource, fragmentSource) {
      const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
      const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
      const program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);

      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error("Champion name program link failed: " + (log || "unknown error"));
      }
      return program;
    }

    let program;
    try {
      program = createProgram(vertexShaderSource, fragmentShaderSource);
    } catch (error) {
      console.warn(error);
      node.innerHTML = "";
      const fallback = document.createElement("span");
      fallback.className = "champion-name-webgl-fallback";
      fallback.textContent = text;
      node.appendChild(fallback);
      return;
    }

    const positionLocation = gl.getAttribLocation(program, "aPosition");
    const uvLocation = gl.getAttribLocation(program, "aUv");
    const projectionViewLocation = gl.getUniformLocation(program, "uProjectionView");
    const modelLocation = gl.getUniformLocation(program, "uModel");
    const textureLocation = gl.getUniformLocation(program, "uTexture");

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -0.5, -0.5, 0,
         0.5, -0.5, 0,
        -0.5,  0.5, 0,
         0.5,  0.5, 0
      ]),
      gl.STATIC_DRAW
    );

    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        0, 1,
        1, 1,
        0, 0,
        1, 0
      ]),
      gl.STATIC_DRAW
    );

    function normalize(v) {
      const length = Math.hypot(v.x, v.y, v.z) || 1;
      return { x: v.x / length, y: v.y / length, z: v.z / length };
    }

    function dot(a, b) {
      return a.x * b.x + a.y * b.y + a.z * b.z;
    }

    function cross(a, b) {
      return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
      };
    }

    /*
     * The supplied ribbon artwork is a bowed/cylindrical front face. Since
     * there is no underlying 3D mesh in the project, the 3D text surface is
     * registered directly to the rendered ribbon image dimensions.
     *
     * theta ∈ [-thetaMax, thetaMax]
     * x = R sin(theta)
     * z = R(cos(theta) - cos(thetaMax))
     *
     * Thus z(center) differs from z(edges), and every glyph is placed on the
     * same continuous 3D surface instead of on an invented 2D text arc.
     */
    const frontWidth = Math.max(240, ribbonRect.width * 0.86);
    const thetaMax = Math.PI * 25 / 180;
    const radius = frontWidth / (2 * Math.sin(thetaMax));
    const curveHeight = Math.min(24, Math.max(10, ribbonRect.height * 0.075));
    const surfaceCenterY = ribbonRect.top + ribbonRect.height * 0.47;
    const surfaceCenterX = ribbonRect.left + ribbonRect.width * 0.50;
    const normalOffset = Math.max(3, Math.min(7, ribbonRect.height * 0.018));

    const centerX = viewportWidth * 0.5;
    const centerY = viewportHeight * 0.5;

    function surfacePoint(u, v = 0) {
      const theta = u * thetaMax;
      const screenX = surfaceCenterX + radius * Math.sin(theta);
      const screenY =
        surfaceCenterY -
        curveHeight * (1 - u * u) +
        v;

      return {
        x: screenX - centerX,
        y: centerY - screenY,
        z: radius * (Math.cos(theta) - Math.cos(thetaMax))
      };
    }

    function surfaceTangent(u) {
      const theta = u * thetaMax;
      return normalize({
        x: radius * thetaMax * Math.cos(theta),
        y: -2 * curveHeight * u,
        z: -radius * thetaMax * Math.sin(theta)
      });
    }

    function surfaceFrame(u) {
      const tangent = surfaceTangent(u);
      const worldUp = { x: 0, y: 1, z: 0 };

      let yAxis = {
        x: worldUp.x - tangent.x * dot(worldUp, tangent),
        y: worldUp.y - tangent.y * dot(worldUp, tangent),
        z: worldUp.z - tangent.z * dot(worldUp, tangent)
      };
      yAxis = normalize(yAxis);

      let normal = normalize(cross(tangent, yAxis));

      if (normal.z < 0) {
        normal.x *= -1;
        normal.y *= -1;
        normal.z *= -1;
        yAxis.x *= -1;
        yAxis.y *= -1;
        yAxis.z *= -1;
      }

      return { tangent, yAxis, normal };
    }

    /*
     * Arc-length sampling of the same 3D surface used for glyph placement.
     * This is what keeps the entire name continuous even for arbitrary
     * strings and prevents long names from being distributed by character
     * count alone.
     */
    const arcSamples = 640;
    const arc = new Array(arcSamples + 1);
    arc[0] = { u: -1, length: 0 };
    let totalArc = 0;
    let previousPoint = surfacePoint(-1);

    for (let i = 1; i <= arcSamples; i++) {
      const u = -1 + (2 * i) / arcSamples;
      const point = surfacePoint(u);
      totalArc += Math.hypot(
        point.x - previousPoint.x,
        point.y - previousPoint.y,
        point.z - previousPoint.z
      );
      arc[i] = { u, length: totalArc };
      previousPoint = point;
    }

    function uAtArcDistance(distance) {
      const target = Math.max(0, Math.min(totalArc, distance));
      let low = 0;
      let high = arc.length - 1;

      while (low < high) {
        const mid = (low + high) >> 1;
        if (arc[mid].length < target) low = mid + 1;
        else high = mid;
      }

      const hi = arc[low];
      const lo = arc[Math.max(0, low - 1)];
      const span = hi.length - lo.length || 1;
      const blend = (target - lo.length) / span;
      return lo.u + (hi.u - lo.u) * blend;
    }

    const availableArc = totalArc * 0.70;
    const maxFontSize = Math.min(56, Math.max(28, window.innerWidth * 0.032));
    const minFontSize = 16;
    const letterGapRatio = 0.035;

    const measureCanvas = document.createElement("canvas");
    const measureContext = measureCanvas.getContext("2d");
    const fontFamily = "'You Blockhead', sans-serif";

    function measureAt(fontSize) {
      measureContext.font = "normal " + fontSize + "px " + fontFamily;
      return chars.map(char => {
        const metrics = measureContext.measureText(char === " " ? "\u00a0" : char);
        return {
          advance: Math.max(1, metrics.width),
          left: Number.isFinite(metrics.actualBoundingBoxLeft)
            ? metrics.actualBoundingBoxLeft
            : 0,
          right: Number.isFinite(metrics.actualBoundingBoxRight)
            ? metrics.actualBoundingBoxRight
            : metrics.width,
          ascent: Number.isFinite(metrics.actualBoundingBoxAscent)
            ? metrics.actualBoundingBoxAscent
            : fontSize * 0.78,
          descent: Number.isFinite(metrics.actualBoundingBoxDescent)
            ? metrics.actualBoundingBoxDescent
            : fontSize * 0.22
        };
      });
    }

    let fontSize = maxFontSize;
    let metrics = measureAt(fontSize);

    function totalAdvanceFor(items, size) {
      const gap = Math.min(3, size * letterGapRatio);
      return items.reduce((sum, item) => sum + item.advance, 0) +
        Math.max(0, items.length - 1) * gap;
    }

    let totalAdvance = totalAdvanceFor(metrics, fontSize);

    if (totalAdvance > availableArc) {
      fontSize = Math.max(minFontSize, fontSize * availableArc / totalAdvance);
      metrics = measureAt(fontSize);
      totalAdvance = totalAdvanceFor(metrics, fontSize);
    }

    const gap = Math.min(3, fontSize * letterGapRatio);
    totalAdvance = totalAdvanceFor(metrics, fontSize);

    const textures = [];
    const glyphs = [];

    function createGlyphTexture(char, metric) {
      const padding = Math.max(8, Math.ceil(fontSize * 0.22));
      const textureWidth = Math.max(2, Math.ceil(metric.advance + padding * 2));
      const textureHeight = Math.max(2, Math.ceil(fontSize * 1.45 + padding * 2));

      const glyphCanvas = document.createElement("canvas");
      glyphCanvas.width = textureWidth;
      glyphCanvas.height = textureHeight;

      const context = glyphCanvas.getContext("2d");
      context.clearRect(0, 0, textureWidth, textureHeight);
      context.font = "normal " + fontSize + "px " + fontFamily;
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      context.imageSmoothingEnabled = true;

      const baseline = padding + metric.ascent;
      const drawX = padding + metric.left;

      if (char !== " ") {
        context.shadowColor = "rgba(54, 20, 0, 0.95)";
        context.shadowBlur = Math.max(0, fontSize * 0.045);
        context.shadowOffsetX = 0;
        context.shadowOffsetY = Math.max(2, fontSize * 0.075);
        context.fillStyle = "#fff7d2";
        context.fillText(char, drawX, baseline);

        context.shadowColor = "rgba(70, 28, 0, 0.9)";
        context.shadowBlur = 0;
        context.shadowOffsetX = 0;
        context.shadowOffsetY = Math.max(3, fontSize * 0.10);
        context.fillStyle = "#fff7d2";
        context.fillText(char, drawX, baseline);
      }

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        glyphCanvas
      );

      textures.push(texture);

      return {
        texture,
        width: metric.advance + padding * 2,
        height: textureHeight,
        metric
      };
    }

    chars.forEach((char, index) => {
      glyphs.push(createGlyphTexture(char, metrics[index]));
    });

    function perspectiveMatrix(fovY, aspect, near, far) {
      const f = 1 / Math.tan(fovY / 2);
      const rangeInv = 1 / (near - far);

      return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (near + far) * rangeInv, -1,
        0, 0, (2 * near * far) * rangeInv, 0
      ]);
    }

    function translationMatrix(z) {
      return new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, z, 1
      ]);
    }

    const cameraZ = 1500;
    const projection = perspectiveMatrix(
      2 * Math.atan((viewportHeight * 0.5) / cameraZ),
      viewportWidth / Math.max(1, viewportHeight),
      1,
      5000
    );
    const camera = translationMatrix(-cameraZ);

    function multiply4x4(a, b) {
      const out = new Float32Array(16);

      for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
          out[col * 4 + row] =
            a[0 * 4 + row] * b[col * 4 + 0] +
            a[1 * 4 + row] * b[col * 4 + 1] +
            a[2 * 4 + row] * b[col * 4 + 2] +
            a[3 * 4 + row] * b[col * 4 + 3];
        }
      }

      return out;
    }

    const projectionView = multiply4x4(projection, camera);

    function modelMatrixForGlyph(u, width, height) {
      const base = surfacePoint(u);
      const frame = surfaceFrame(u);
      const position = {
        x: base.x + frame.normal.x * normalOffset,
        y: base.y + frame.normal.y * normalOffset,
        z: base.z + frame.normal.z * normalOffset
      };

      return new Float32Array([
        frame.tangent.x * width,
        frame.tangent.y * width,
        frame.tangent.z * width,
        0,

        frame.yAxis.x * height,
        frame.yAxis.y * height,
        frame.yAxis.z * height,
        0,

        frame.normal.x,
        frame.normal.y,
        frame.normal.z,
        0,

        position.x,
        position.y,
        position.z,
        1
      ]);
    }

    function draw() {
      if (!document.documentElement.contains(canvas)) return;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);

      gl.useProgram(program);
      gl.uniformMatrix4fv(projectionViewLocation, false, projectionView);

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.enableVertexAttribArray(uvLocation);
      gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);

      let cursor = -totalAdvance / 2;

      glyphs.forEach((glyph, index) => {
        const metric = metrics[index];
        const centerDistance = cursor + metric.advance / 2;
        const arcDistance = totalArc / 2 + centerDistance;
        const u = uAtArcDistance(arcDistance);

        const model = modelMatrixForGlyph(
          u,
          glyph.width,
          glyph.height
        );

        gl.uniformMatrix4fv(modelLocation, false, model);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, glyph.texture);
        gl.uniform1i(textureLocation, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        cursor += metric.advance + gap;
      });
    }

    draw();

    node._championName3DCleanup = () => {
      textures.forEach(texture => gl.deleteTexture(texture));
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(uvBuffer);
      gl.deleteProgram(program);
    };

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (
          document.documentElement.contains(node) &&
          node.dataset.championName === text
        ) {
          shapeChampionName(text);
        }
      });
    }
  }

  function playChampionVictory() {
    const audio = document.getElementById("champion-victory-audio");
    if (audio) {
      audio.currentTime = 0;
      const p = audio.play();
      if (p) {
        p.catch(() => playVictoryFallback());
        return;
      }
    }
    playVictoryFallback();
  }

  function playVictoryFallback() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const notes = [
        [523.25, 0.00, .22], [659.25, .16, .22], [783.99, .32, .28],
        [1046.5, .54, .42], [783.99, .72, .24], [1046.5, .90, .55]
      ];
      notes.forEach(([freq, start, duration]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(0.16, now + start + .025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + duration + .03);
      });
      setTimeout(() => ctx.close(), 1800);
    } catch (_) {}
  }

  function celebrateChampion(name) {
    const splash = document.getElementById("champion-splash");
    shapeChampionName(name);
    splash.classList.remove("show");
    void splash.offsetWidth;
    splash.classList.add("show");
    playChampionVictory();
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
      
      // Route through the open corridor between rounds. Do not let the
      // connector curve enter the target player's name/card area.
      const gap = Math.max(24, Math.min(70, Math.abs(x2 - x1) * 0.42));
      const bendX = (conn.direction === 'right')
        ? x1 + gap
        : x1 - gap;
      const approachX = (conn.direction === 'right')
        ? x2 - gap
        : x2 + gap;
      const d = `M ${x1} ${y1} C ${bendX} ${y1}, ${approachX} ${y2}, ${x2} ${y2}`;
      
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
      const splash = document.getElementById("champion-splash");
      if (splash && splash.classList.contains("show")) {
        const championName = document.getElementById("champion-name");
        if (championName) {
          shapeChampionName(championName.dataset.championName || championName.textContent.replace(/\u00a0/g, " "));
        }
      }
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
