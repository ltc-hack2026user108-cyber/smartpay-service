import { Injectable, ConflictException } from '@nestjs/common';
import { FirestoreProvider } from '../firestore/firestore.provider';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  private readonly collection = 'orders';

  constructor(private readonly firestoreProvider: FirestoreProvider) {}

  async create(dto: CreateOrderDto): Promise<CreateOrderDto> {
    const db = this.firestoreProvider.getDb();
    const docRef = db.collection(this.collection).doc(dto._id);

    const existing = await docRef.get();
    if (existing.exists) {
      throw new ConflictException(`Order ${dto._id} already exists`);
    }

    await docRef.set(dto);
    return dto;
  }
}
