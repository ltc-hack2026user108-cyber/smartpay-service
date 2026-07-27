import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { Firestore } from 'firebase-admin/firestore';
import * as serviceAccount from '../../smartpay-backend-key.json';

@Injectable()
export class FirestoreProvider implements OnApplicationBootstrap {
  private readonly logger = new Logger(FirestoreProvider.name);
  private db: Firestore;

  onApplicationBootstrap() {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
        projectId: 'smooth-splicer-503308-m1',
      });
    }

    this.db = admin.firestore();
    this.db.settings({ databaseId: 'smartpay-syndicate' });
    this.logger.log('Firestore connected → smartpay-syndicate');
  }

  getDb(): Firestore {
    return this.db;
  }
}
