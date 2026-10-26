import playdateService from '../playdate/playdate.service.js';
import connectionService from '../connection/connection.service.js';
import { AdminPlaydateDTO, AdminConnectionDTO } from './admin.dto.js';

class AdminService {
  /**
   * Get paginated playdates for admin oversight
   */
  async getPlaydates(options) {
    const { items, pagination } = await playdateService.getPlaydatesForAdmin(options);
    return {
      items: AdminPlaydateDTO.toResponseList(items),
      pagination,
    };
  }

  /**
   * Get single playdate detail for admin oversight
   */
  async getPlaydateDetail(id) {
    const { playdate, pendingReschedule } = await playdateService.getPlaydateDetailForAdmin(id);
    return AdminPlaydateDTO.toDetailResponse(playdate, pendingReschedule);
  }

  /**
   * Force-cancel an upcoming playdate by admin
   */
  async cancelPlaydate(id, reason) {
    const updated = await playdateService.cancelPlaydateByAdmin(id, reason);
    return AdminPlaydateDTO.toDetailResponse(updated);
  }

  /**
   * Get paginated connections for admin oversight
   */
  async getConnections(options) {
    const { items, pagination } = await connectionService.getConnectionsForAdmin(options);
    return {
      items: AdminConnectionDTO.toResponseList(items),
      pagination,
    };
  }

  /**
   * Get single connection detail for admin oversight
   */
  async getConnectionDetail(id) {
    const connection = await connectionService.getConnectionDetailForAdmin(id);
    return AdminConnectionDTO.toDetailResponse(connection);
  }

  /**
   * Soft-remove a connection by admin
   */
  async removeConnection(id, reason) {
    const updated = await connectionService.removeConnectionByAdmin(id, reason);
    return AdminConnectionDTO.toDetailResponse(updated);
  }
}

export const adminService = new AdminService();
export default adminService;
