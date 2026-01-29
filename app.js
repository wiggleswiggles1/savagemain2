const { Engine, Render, Runner, Bodies, World, Events } = Matter;

const engine = Engine.create();
const world = engine.world;
engine.gravity.y = 0.7;

const render = Render.create({
    element: document.getElementById('canvas-container'),
    engine: engine,
    options: { width: 600, height: 800, wireframes: false, background: 'transparent' }
});
let notificationsEnabled = true;
// --- NOTIFICATION SYSTEM ---
function showNoti(text, type = '') {
    if (!notificationsEnabled) return;

    const container = document.getElementById('notification-container');
    if (!container) return;

    // --- LIMIT LOGIC ---
    // If there are already 3 notifications, remove the oldest one immediately
    while (container.children.length >= 3) {
        container.removeChild(container.firstChild);
    }

    const noti = document.createElement('div');
    noti.className = `noti ${type}`;
    noti.innerHTML = text;
    
    container.appendChild(noti);

    // Remove automatically after 5 seconds
    setTimeout(() => {
        if (noti.parentNode === container) {
            noti.remove();
        }
    }, 5000);
}

// --- WALLS & FUNNEL ---
const wallOptions = { isStatic: true, render: { visible: false } };
World.add(world, [
    Bodies.rectangle(-5, 400, 10, 800, wallOptions),
    Bodies.rectangle(605, 400, 10, 800, wallOptions),
    Bodies.rectangle(160, 40, 220, 10, { isStatic: true, angle: Math.PI / 5, render: { visible: false } }),
    Bodies.rectangle(440, 40, 220, 10, { isStatic: true, angle: -Math.PI / 5, render: { visible: false } })
]);

// --- PEGS (Trapezoid Layout) ---
const rows = 16; 
for (let i = 0; i < rows; i++) {
    const pegsInRow = i + 3; 
    for (let j = 0; j < pegsInRow; j++) {
        const x = 300 + (j - (pegsInRow - 1) / 2) * 32; 
        const y = 120 + i * 38; 
        World.add(world, Bodies.circle(x, y, 3, { 
            isStatic: true, 
            restitution: 0.5,
            render: { fillStyle: '#ffffff' } 
        }));
    }
}

// --- BUCKET SENSORS (Your preferred values) ---
const bucketValues = [100, 50, 25, 15, 10, 5, 1, -1, -2, -1, 1, 5, 10, 15, 25, 50, 100];
const totalWidth = 600;
const bWidth = totalWidth / bucketValues.length;

bucketValues.forEach((val, i) => {
    const x = (i * bWidth) + (bWidth / 2);
    const sensor = Bodies.rectangle(x, 750, bWidth, 60, {
        isStatic: true, isSensor: true, label: `bucket-${val}`, render: { visible: false }
    });
    World.add(world, sensor);
});

// --- DROP BALL (Controlled Physics) ---
function dropBall(username) {
    const spawnX = 300 + (Math.random() * 6 - 3); // Narrower spawn for center favor
    const ball = Bodies.circle(spawnX, 10, 8, {
        restitution: 0.4, friction: 0.05, frictionAir: 0.05, label: 'ball',
        render: { fillStyle: '#53fc18', strokeStyle: '#fff', lineWidth: 2 }
    });
    ball.username = username;
    World.add(world, ball);

    const force = (Math.random() - 0.5) * 0.0005; // Light nudge
    Matter.Body.applyForce(ball, ball.position, { x: force, y: 0 });
}

// --- DROP QUEUE ---
let dropQueue = [];
let isProcessingQueue = false;
async function processQueue() {
    if (isProcessingQueue || dropQueue.length === 0) return;
    isProcessingQueue = true;
    while (dropQueue.length > 0) {
        const username = dropQueue.shift();
        dropBall(username);
        await new Promise(resolve => setTimeout(resolve, 400)); 
    }
    isProcessingQueue = false;
}

// --- COLLISIONS ---
Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach((pair) => {
        const { bodyA, bodyB } = pair;
        const isBucket = (b) => b.label && b.label.startsWith('bucket-');
        if (isBucket(bodyA) || isBucket(bodyB)) {
            const bucket = isBucket(bodyA) ? bodyA : bodyB;
            const ball = isBucket(bodyA) ? bodyB : bodyA;
            if (ball.label === 'ball' && ball.username) {
                const amount = parseInt(bucket.label.slice(7));
                if (amount < 0) { showNoti(`💀 @${ball.username} lost ${Math.abs(amount)} Balls!`, 'noti-admin'); } 
                else { showNoti(`🎉 @${ball.username} landed on ${amount} Balls!`, amount >= 25 ? 'noti-bigwin' : ''); }
                
                database.ref(`users/${ball.username.toLowerCase()}`).transaction((data) => {
                    if (!data) return null; 
                    data.points = Math.max(0, (data.points || 0) + amount);
                    if (amount > 0) data.wins = (data.wins || 0) + amount;
                    return data;
                });
                World.remove(world, ball);
            }
        }
    });
});

// --- FIREBASE LISTENERS ---
database.ref('drops').on('child_added', (snapshot) => {
    const data = snapshot.val();
    if (data?.username) {
        dropQueue.push(data.username);
        processQueue();
        database.ref('drops/' + snapshot.key).remove();
    }
});
// --- ADMIN COMMANDS LISTENER ---
database.ref('admin_commands').on('child_added', (snapshot) => {
    const cmd = snapshot.val();
    if (!cmd) return;

    if (cmd.type === 'reset_all') {
        // 1. Physically remove all active balls from the Matter.js world
        const activeBalls = world.bodies.filter(b => b.label === 'ball');
        activeBalls.forEach(ball => World.remove(world, ball));

        // 2. Clear the visual leaderboard list immediately
        const list = document.getElementById('leaderboard-list');
        if (list) list.innerHTML = '';

        // 3. Show a reset notification
        showNoti("SYSTEM: GAME RESET BY ADMIN", "noti-admin");
    }

    // Clean up the command after processing so it doesn't trigger on refresh
    database.ref('admin_commands/' + snapshot.key).remove();
});

// --- LEADERBOARD (Points Based) ---
database.ref('users').orderByChild('points').limitToLast(5).on('value', (snapshot) => {
    const list = document.getElementById('leaderboard-list');
    if (!list) return;
    list.innerHTML = '';
    let players = [];
    snapshot.forEach(c => {
        const pData = c.val();
        players.push({ name: c.key, pts: pData.points || 0 });
    });
    players.reverse().forEach((p, i) => {
        const li = document.createElement('li');
        const isFirst = i === 0;
        li.innerHTML = `
            <span style="color: #888; width: 22px; display: inline-block;">${i + 1}.</span> 
            <span class="${isFirst ? 'top-player' : ''}" style="color: ${isFirst ? '#ffd700' : '#53fc18'}; flex: 1;">
                ${isFirst ? '👑 ' : ''}${p.name}
            </span> 
            <span style="font-weight: bold; color: white;">${p.pts} Balls</span>`;
        list.appendChild(li);
    });
});

Render.run(render);
Runner.run(Runner.create(), engine);