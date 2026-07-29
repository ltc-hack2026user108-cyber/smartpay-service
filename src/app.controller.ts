import { Controller, Get, Param, HttpException, HttpStatus } from '@nestjs/common';
import { GculService } from './orders/gcul.service';

@Controller()
export class AppController {
  constructor(private readonly gculService: GculService) {}

  @Get('hello')
  getHello(): string {
    return 'Hello World!';
  }

  @Get('balance/:accountId')
  async getBalance(@Param('accountId') accountId: string) {
    try {
      const res= await this.gculService.queryBalance(accountId);
      return {accountId:res?.accountId, balance:res?.balance};
    } catch (error) {
      throw new HttpException(
        { error: 'Balance query failed', details: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
