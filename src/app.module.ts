import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { OrdersModule } from './orders/orders.module';
import { FirestoreModule } from './firestore/firestore.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [FirestoreModule, OrdersModule, AdminModule],
  controllers: [AppController],
})
export class AppModule {}
