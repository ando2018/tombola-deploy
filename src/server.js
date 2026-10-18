import { creerApp } from './app.js';
import { config } from './config.js';
import { connecterDb } from './db.js';

await connecterDb();
creerApp().listen(config.port, () => {
  console.log(`API Tombola : http://localhost:${config.port}`);
});
