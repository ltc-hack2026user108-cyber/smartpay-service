import { Controller, Get, Param } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  async getDashboardDetails() {
    return this.adminService.getDashboardDetails();
  }

  @Get('account/:userId')
  async getAccountDetail(@Param('userId') userId: string) {
    return this.adminService.getAccountDetail(userId);
  }

  @Get('orders')
  async getAllOrderDetails() {
    return this.adminService.getAllOrderDetails();
  }

  @Get('ledger')
  async getLedger() {
    return this.adminService.getLedger();
  }
}
