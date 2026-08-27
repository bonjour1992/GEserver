const path = require('path');
const Service = require('node-windows').Service;

// Create a new service object
const svc = new Service({
    name: 'EHRService',  // Name of the service
    description: 'EHR Service running as a Windows Service.',  // Description of the service
    script: path.join(__dirname,  'main.js'),  // Path to your minified app (replace with your minified index.js)
});

// Event listener when the service is installed
svc.on('install', function () {
    console.log('Service installed successfully!');
    svc.start();
});

// Event listener when the service is uninstalled
svc.on('uninstall', function () {
    console.log('Service uninstalled successfully!');
});

// Install the service
svc.install();