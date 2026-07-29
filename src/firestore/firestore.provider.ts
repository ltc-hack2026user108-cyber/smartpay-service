 import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { Firestore } from 'firebase-admin/firestore';

@Injectable()
export class FirestoreProvider implements OnApplicationBootstrap {
  private readonly logger = new Logger(FirestoreProvider.name);
  private db: Firestore;

onApplicationBootstrap() {
 if (!admin.apps.length) {
      admin.initializeApp({
        projectId: 'ltc-hack2026-team22',
      });
    }

    this.db = admin.firestore();

    this.db.settings({
      databaseId: 'smartpay-service',
    });

    this.logger.log('Firestore connected → smartpay-service');
  }

  getDb(): Firestore {
    return this.db;
  }
}
