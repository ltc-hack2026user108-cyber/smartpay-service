import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { GculService } from './gcul.service';
import { ShippoService } from './shippo.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, ShippoService, GculService],
  exports: [OrdersService, GculService],
})
export class OrdersModule {}
