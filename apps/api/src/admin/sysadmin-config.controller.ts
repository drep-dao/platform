import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminGuard } from './admin.guard';
import { CurrentAdmin } from './current-admin.decorator';
import type { AdminIdentity } from './admin-auth.service';
import { AdminAuditService } from './admin-audit.service';
import { GovernanceService } from '../governance/governance.service';
import { UpdateParamDto, UpdateOnchainSourceDto } from '../governance/governance.controller';

/**
 * §18 — platform-admin BREAK-GLASS configuration. Governance parameters and the on-chain
 * data source are normally board-only (BoardGuard). But at genesis there is NO board yet
 * (open admission → DReps join and must first elect one), so nobody could configure the
 * platform. These admin-only, 2FA-gated endpoints let the operator set that config during
 * the no-board bootstrap, and remain as a permanent operational fallback. Every change is
 * written to the append-only admin audit log. The board uses the normal board UI once elected.
 */
@Controller('sysadmin/config')
@UseGuards(AdminGuard)
export class SysadminConfigController {
  constructor(
    private readonly gov: GovernanceService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  list() {
    return this.gov.getParams();
  }

  @Patch()
  async update(@CurrentAdmin() admin: AdminIdentity, @Body() dto: UpdateParamDto, @Req() req: Request) {
    // updated_by is an AppUser FK — an admin is not an AppUser, so the actor is null here;
    // the "who" is captured in the admin audit log instead.
    const res = await this.gov.updateParam(null, dto.key, dto.value);
    await this.audit.log({
      adminId: admin.adminId,
      action: 'config.param.update',
      target: dto.key,
      payload: { value: res.value },
      ip: req.ip /* SEC-06: trusted framework IP, not spoofable XFF */,
      userAgent: req.headers['user-agent'],
    });
    return res;
  }

  @Get('onchain-source')
  onchainSource() {
    return this.gov.getOnchainSource();
  }

  @Patch('onchain-source')
  async updateOnchainSource(@CurrentAdmin() admin: AdminIdentity, @Body() dto: UpdateOnchainSourceDto, @Req() req: Request) {
    const res = await this.gov.updateOnchainSource(null, dto);
    await this.audit.log({
      adminId: admin.adminId,
      action: 'config.onchain-source.update',
      target: 'CARDANO_ONCHAIN_ORDER',
      // Never log secret values — only which fields changed + the resulting order.
      payload: {
        order: res.order,
        changed: [
          dto.order !== undefined ? 'order' : null,
          dto.koiosApiToken !== undefined ? 'koiosApiToken' : null,
          dto.blockfrostProjectId !== undefined ? 'blockfrostProjectId' : null,
          dto.dbsyncUrl !== undefined ? 'dbsyncUrl' : null,
        ].filter(Boolean),
      },
      ip: req.ip /* SEC-06: trusted framework IP, not spoofable XFF */,
      userAgent: req.headers['user-agent'],
    });
    return res;
  }
}
