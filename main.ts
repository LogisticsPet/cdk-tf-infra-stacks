import { App } from 'cdktf';

const app = new App();

const context = app.node.getAllContext();

console.log(context);

app.synth();
