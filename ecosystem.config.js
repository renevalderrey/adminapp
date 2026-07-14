module.exports = {
  apps: [{
    name: 'comprafit-backend',
    script: 'src/server.js',
    cwd: './backend',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
    },
    max_memory_restart: '256M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
  }],
};
