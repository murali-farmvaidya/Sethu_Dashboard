const { exec } = require('child_process');
const os = require('os');

const scriptName = process.argv[2];

if (!scriptName) {
    console.error('Please provide a script name partial match.');
    process.exit(0);
}

console.log(`🔍 Checking for processes matching "${scriptName}"...`);

if (os.platform() !== 'win32') {
    // Linux/Mac/Unix
    exec(`pkill -f "${scriptName}"`, (err) => {
        if (!err) {
            console.log(`✅ Killed existing processes matching "${scriptName}".`);
        } else {
            // pkill returns exit code 1 if no process matched
            console.log(`ℹ️  No previous process found.`);
        }
    });
} else {
    // Windows Implementation
    const query = `wmic process where "commandline like '%${scriptName}%' and name='node.exe'" get processid`;

    exec(query, (err, stdout) => {
        if (err) {
            // Command failed or no process found (sometimes wmic errors if none found)
            console.log(`ℹ️  No previous process found (or query check failed).`);
            return;
        }

        // Parse output
        const lines = stdout.trim().split(/\s+/);
        // First line is header "ProcessId", rest are PIDs
        let pids = lines.slice(1).filter(pid => /^\d+$/.test(pid));

        // Filter out current process PID just in case
        pids = pids.filter(pid => pid !== process.pid.toString());

        if (pids.length > 0) {
            console.log(`Found PIDs: ${pids.join(', ')}. Killing...`);
            exec(`taskkill /F /PID ${pids.join(' /PID ')}`, (killErr) => {
                if (!killErr) console.log('✅ Killed existing processes.');
                else console.log('⚠️ Failed to kill processes (might be already dead).');
            });
        } else {
            console.log(`ℹ️  No matching process found.`);
        }
    });
}
