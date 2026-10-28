import logger from '../../../shared/logger/index.js';
import AppError from '../../../shared/exceptions/AppError.js';
import { getMyChildrenTool } from './get-my-children.tool.js';
import { findMatchesTool } from './find-matches.tool.js';
import { findNearbyPlacesTool } from './find-nearby-places.tool.js';
import {
  suggestTimeSlotsTool,
  findAvailablePlaymatesTool,
  suggestActivitiesTool,
  suggestPlacesTool,
} from './suggestion-tools.js';
import { proposePlaydateTool } from './propose-playdate.tool.js';
import { sendConnectionRequestsTool } from './send-connection-requests.tool.js';
import { stripSensitive } from './tool-sanitizer.js';

/**
 * AI Function Calling tools: each wraps domain services (never repositories) and returns public data only.
 */
const TOOLS = [
  getMyChildrenTool,
  findMatchesTool,
  findNearbyPlacesTool,
  suggestTimeSlotsTool,
  findAvailablePlaymatesTool,
  suggestActivitiesTool,
  suggestPlacesTool,
  proposePlaydateTool,
  sendConnectionRequestsTool,
];
const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.declaration.name, tool]));

export const functionDeclarations = TOOLS.map((tool) => tool.declaration);

/**
 * Run one tool call. Errors become a result the model can explain to the parent, they never fail the turn.
 * @param {string} name
 * @param {Object} args
 * @param {Object} ctx - Tool context (tool-context.js)
 * @returns {Promise<Object>} Result without sensitive keys
 */
export const executeTool = async (name, args, ctx) => {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) {
    return { error: { code: 'UNKNOWN_TOOL', message: `No tool named ${name}` } };
  }

  ctx.turn.toolsUsed.push(name);
  try {
    return stripSensitive(await tool.execute(args || {}, ctx));
  } catch (error) {
    if (error instanceof AppError && error.isOperational) {
      return { error: { code: error.code, message: error.message } };
    }
    logger.error(`[AI tool ${name}] ${error.stack || error.message}`);
    return { error: { code: 'TOOL_FAILED', message: 'This information is not available right now.' } };
  }
};
