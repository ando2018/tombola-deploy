import mongoose from 'mongoose';
import { config } from './config.js';

export async function connecterDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri);
  console.log(`MongoDB connecté : ${mongoose.connection.name}`);
}
