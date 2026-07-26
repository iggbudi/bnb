import { runDirectionalBacktestCli } from '../features/directional-paper/index.js';
import { bootstrapApplicationDatabase } from './database-bootstrap.js';

bootstrapApplicationDatabase();
runDirectionalBacktestCli();
