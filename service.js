import path from 'path';
import { Service } from 'node-windows';


// Create a new service object
const svc = new Service({
    name: 'GEserver',  // Name of the service
    description: 'server pour l editeur de titou.',  // Description of the service
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