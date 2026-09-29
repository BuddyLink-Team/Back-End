import childService from './child.service.js';
import { successResponse } from '../../shared/response/index.js';

class ChildController {
  async createChild(req, res, next) {
    try {
      const child = await childService.createChild(req.userId, req.body);
      return successResponse(res, child, 'Tạo hồ sơ bé thành công', 201);
    } catch (error) {
      return next(error);
    }
  }

  async getMyChildren(req, res, next) {
    try {
      const children = await childService.getMyChildren(req.userId);
      return successResponse(res, children, 'Danh sách hồ sơ các bé', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getChildById(req, res, next) {
    try {
      const child = await childService.getChildById(req.params.id);
      return successResponse(res, child, 'Thông tin chi tiết hồ sơ bé', 200);
    } catch (error) {
      return next(error);
    }
  }

  async updateChild(req, res, next) {
    try {
      const child = await childService.updateChild(req.userId, req.params.id, req.body);
      return successResponse(res, child, 'Cập nhật hồ sơ bé thành công', 200);
    } catch (error) {
      return next(error);
    }
  }

  async deleteChild(req, res, next) {
    try {
      const result = await childService.deleteChild(req.userId, req.params.id);
      return successResponse(res, result, 'Xóa hồ sơ bé thành công', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export default new ChildController();
