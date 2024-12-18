const { exec } = require('child_process');

// Capture the full task name (e.g., 'deploy core')
const task = process.argv[2];
const platform = process.argv[3]

// Split the task name into command and stack

if (!task || task !== 'deploy' && task !== 'destroy') {
  console.error('Invalid command. Use "deploy" or "destroy".');
  process.exit(1);
}

if (!platform) {
  console.error('Please provide a valid platform name (e.g. dev/test/prod).');
  process.exit(1);
}

const command = `cdktf ${task} '${platform}-*' --auto-approve`
console.log(`Running command - '${command}'`);

const deployProcess = exec(command);

deployProcess.stdout.on('data', (data) => {
  console.log(data);
});

deployProcess.stderr.on('data', (data) => {
  console.error(data);
});

deployProcess.on('close', (code) => {
  if (code !== 0) {
    console.error(`${command} failed with exit code ${code}`);
    process.exit(code); // Ensure the script fails if the command fails
  } else {
    console.log(`${command} succeeded`);
  }
});
