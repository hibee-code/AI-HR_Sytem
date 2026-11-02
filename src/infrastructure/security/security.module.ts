import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { ClamdScanner, MALWARE_SCANNER, NO_SCANNER } from './malware-scanner';

@Global()
@Module({
  providers: [
    {
      provide: MALWARE_SCANNER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const host = config.get('CLAMAV_HOST', { infer: true });
        return host && !config.get('MALWARE_SCAN_DISABLED', { infer: true })
          ? new ClamdScanner(host, config.get('CLAMAV_PORT', { infer: true }))
          : NO_SCANNER;
      },
    },
  ],
  exports: [MALWARE_SCANNER],
})
export class SecurityModule {}
