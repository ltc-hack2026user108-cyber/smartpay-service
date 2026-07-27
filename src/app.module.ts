import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { OrdersModule } from './orders/orders.module';
import { FirestoreModule } from './firestore/firestore.module';

@Module({
  imports: [FirestoreModule, OrdersModule],
  controllers: [AppController],
})
export class AppModule {}
