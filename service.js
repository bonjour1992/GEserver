import path from 'path';
import { Service } from 'node-windows';
<<<<<<< HEAD

=======
>>>>>>> 42004c9e8f189e8a2503e7b6d7160d90294e9c1f

// Create a new service object
const svc = new Service({
    name: 'GEserver',  // Name of the service
    description: 'server pour l editeur de titou.',  // Description of the service
    script: 'e://GE/server/main.js'),  // Path to your minified app (replace with your minified index.js)
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