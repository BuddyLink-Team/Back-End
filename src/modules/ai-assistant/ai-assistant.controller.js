import aiAssistantService from './ai-assistant.service.js';
import { successResponse } from '../../shared/response/index.js';

class AIAssistantController {
  /**
   * POST /api/v1/ai-assistant/sessions
   */
  async createSession(req, res, next) {
    try {
      const data = await aiAssistantService.createSession(req.userId);
      return successResponse(res, data, 'Chat session created', 201);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/ai-assistant/sessions?page=&limit=
   */
  async listSessions(req, res, next) {
    try {
      const data = await aiAssistantService.listSessions(req.userId, req.query);
      return successResponse(res, data, 'Chat sessions retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/ai-assistant/sessions/:id
   */
  async getSession(req, res, next) {
    try {
      const data = await aiAssistantService.getSession(req.userId, req.params.id);
      return successResponse(res, data, 'Chat session retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/v1/ai-assistant/sessions/:id/messages
   * Body: { content, choice? }
   */
  async sendMessage(req, res, next) {
    try {
      const { content, choice } = req.body;
      const data = await aiAssistantService.sendMessage(req.userId, req.params.id, { content, choice });
      return successResponse(res, data, 'Reply generated successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * DELETE /api/v1/ai-assistant/sessions/:id
   */
  async deleteSession(req, res, next) {
    try {
      await aiAssistantService.deleteSession(req.userId, req.params.id);
      return successResponse(res, null, 'Chat session deleted', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export const aiAssistantController = new AIAssistantController();
export default aiAssistantController;
