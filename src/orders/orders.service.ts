import { Injectable, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { FirestoreProvider } from '../firestore/firestore.provider';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  private readonly collection = 'orders';
  private readonly logger = new Logger(OrdersService.name);

  constructor(private readonly firestoreProvider: FirestoreProvider) {}

  async create(dto: CreateOrderDto): Promise<{ message: string; order: CreateOrderDto }> {
    const db = this.firestoreProvider.getDb();
    const docRef = db.collection(this.collection).doc(dto._id);

    const existing = await docRef.get();
    if (existing.exists) {
      throw new ConflictException(`Order ${dto._id} already exists`);
    }

    await docRef.set(dto);
    this.logger.log(`Order ${dto._id} saved to Firestore`);

    return { message: 'Order created successfully', order: dto };
  }

  async findAll(): Promise<CreateOrderDto[]> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).get();
    return snapshot.docs.map((doc) => doc.data() as CreateOrderDto);
  }

  async findOne(id: string): Promise<CreateOrderDto> {
    const db = this.firestoreProvider.getDb();
    const doc = await db.collection(this.collection).doc(id).get();
    if (!doc.exists) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return doc.data() as CreateOrderDto;
  }
}
