// pm2 start ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'tombola',
    cwd: __dirname,
    script: 'src/server.js',
    node_args: '--env-file-if-exists=.env',
    env: { NODE_ENV: 'production' },
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    max_memory_restart: '400M',
    time: true,
  }],
};
