import { Global, Module } from '@nestjs/common';
import { FirestoreProvider } from './firestore.provider';

@Global()
@Module({
  providers: [FirestoreProvider],
  exports: [FirestoreProvider],
})
export class FirestoreModule {}
