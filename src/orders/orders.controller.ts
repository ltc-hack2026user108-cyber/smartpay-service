import { Controller, Post, Get, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.create(createOrderDto);
  }

  @Get()
  async findAll() {
    return this.ordersService.findAll();
  }

  @Get('buyers/:buyerId')
  async findByBuyer(@Param('buyerId') buyerId: string) {
    return this.ordersService.findByBuyer(buyerId);
  }

  @Get('sellers/:sellerId')
  async findBySeller(@Param('sellerId') sellerId: string) {
    return this.ordersService.findBySeller(sellerId);
  }

  @Post(':id/accept')
  async acceptOrder(@Param('id') id: string) {
    return this.ordersService.updateOrderStatus(id, 'ACCEPTED');
  }

  @Post(':id/decline')
  async declineOrder(@Param('id') id: string) {
    return this.ordersService.updateOrderStatus(id, 'DECLINED');
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }
}
