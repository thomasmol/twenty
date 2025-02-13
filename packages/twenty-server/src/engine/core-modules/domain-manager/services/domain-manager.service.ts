import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import { isDefined } from 'twenty-shared';

import { CustomDomainValidRecords } from 'src/engine/core-modules/domain-manager/dtos/custom-domain-valid-records';
import { generateRandomSubdomain } from 'src/engine/core-modules/domain-manager/utils/generate-random-subdomain';
import { getSubdomainFromEmail } from 'src/engine/core-modules/domain-manager/utils/get-subdomain-from-email';
import { getSubdomainNameFromDisplayName } from 'src/engine/core-modules/domain-manager/utils/get-subdomain-name-from-display-name';
import { EnvironmentService } from 'src/engine/core-modules/environment/environment.service';
import { Workspace } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceSubdomainCustomDomainAndIsCustomDomainEnabledType } from 'src/engine/core-modules/domain-manager/domain-manager.type';

@Injectable()
export class DomainManagerService {
  constructor(
    @InjectRepository(Workspace, 'core')
    private readonly workspaceRepository: Repository<Workspace>,
    private readonly environmentService: EnvironmentService,
  ) {}

  getFrontUrl() {
    let baseUrl: URL;
    const frontPort = this.environmentService.get('FRONT_PORT');
    const frontDomain = this.environmentService.get('FRONT_DOMAIN');
    const frontProtocol = this.environmentService.get('FRONT_PROTOCOL');

    const serverUrl = this.environmentService.get('SERVER_URL');

    if (!frontDomain) {
      baseUrl = new URL(serverUrl);
    } else {
      baseUrl = new URL(`${frontProtocol}://${frontDomain}`);
    }

    if (frontPort) {
      baseUrl.port = frontPort.toString();
    }

    if (frontProtocol) {
      baseUrl.protocol = frontProtocol;
    }

    return baseUrl;
  }

  getBaseUrl(): URL {
    const baseUrl = this.getFrontUrl();

    if (
      this.environmentService.get('IS_MULTIWORKSPACE_ENABLED') &&
      this.environmentService.get('DEFAULT_SUBDOMAIN')
    ) {
      baseUrl.hostname = `${this.environmentService.get('DEFAULT_SUBDOMAIN')}.${baseUrl.hostname}`;
    }

    return baseUrl;
  }

  buildEmailVerificationURL({
    emailVerificationToken,
    email,
    workspace,
  }: {
    emailVerificationToken: string;
    email: string;
    workspace: WorkspaceSubdomainCustomDomainAndIsCustomDomainEnabledType;
  }) {
    return this.buildWorkspaceURL({
      workspace,
      pathname: 'verify-email',
      searchParams: { emailVerificationToken, email },
    });
  }

  buildWorkspaceURL({
    workspace,
    pathname,
    searchParams,
  }: {
    workspace: WorkspaceSubdomainCustomDomainAndIsCustomDomainEnabledType;
    pathname?: string;
    searchParams?: Record<string, string | number>;
  }) {
    const workspaceUrls = this.getWorkspaceUrls(workspace);

    const url = new URL(workspaceUrls.customUrl ?? workspaceUrls.subdomainUrl);

    if (pathname) {
      url.pathname = pathname;
    }

    if (searchParams) {
      Object.entries(searchParams).forEach(([key, value]) => {
        if (isDefined(value)) {
          url.searchParams.set(key, value.toString());
        }
      });
    }

    return url;
  }

  getSubdomainAndCustomDomainFromUrl = (url: string) => {
    const { hostname: originHostname } = new URL(url);

    const frontDomain = this.getFrontUrl().hostname;

    const isFrontdomain = originHostname.endsWith(`.${frontDomain}`);

    const subdomain = originHostname.replace(`.${frontDomain}`, '');

    return {
      subdomain:
        isFrontdomain && !this.isDefaultSubdomain(subdomain)
          ? subdomain
          : undefined,
      customDomain: isFrontdomain ? null : originHostname,
    };
  };

  async getWorkspaceBySubdomainOrDefaultWorkspace(subdomain?: string) {
    return subdomain
      ? await this.workspaceRepository.findOne({
          where: { subdomain },
        })
      : await this.getDefaultWorkspace();
  }

  isDefaultSubdomain(subdomain: string) {
    return subdomain === this.environmentService.get('DEFAULT_SUBDOMAIN');
  }

  computeRedirectErrorUrl(
    errorMessage: string,
    workspace: WorkspaceSubdomainCustomDomainAndIsCustomDomainEnabledType,
  ) {
    const url = this.buildWorkspaceURL({
      workspace,
      pathname: '/verify',
      searchParams: { errorMessage },
    });

    return url.toString();
  }

  private async getDefaultWorkspace() {
    if (!this.environmentService.get('IS_MULTIWORKSPACE_ENABLED')) {
      const defaultWorkspaceSubDomain =
        this.environmentService.get('DEFAULT_SUBDOMAIN');

      if (isDefined(defaultWorkspaceSubDomain)) {
        const foundWorkspaceForDefaultSubDomain =
          await this.workspaceRepository.findOne({
            where: { subdomain: defaultWorkspaceSubDomain },
            relations: ['workspaceSSOIdentityProviders'],
          });

        if (isDefined(foundWorkspaceForDefaultSubDomain)) {
          return foundWorkspaceForDefaultSubDomain;
        }
      }

      const workspaces = await this.workspaceRepository.find({
        order: {
          createdAt: 'DESC',
        },
        relations: ['workspaceSSOIdentityProviders'],
      });

      if (workspaces.length > 1) {
        Logger.warn(
          `In single-workspace mode, there should be only one workspace. Today there are ${workspaces.length} workspaces`,
        );
      }

      return workspaces[0];
    }

    throw new Error(
      'Default workspace not exist when multi-workspace is enabled',
    );
  }

  async getWorkspaceByOriginOrDefaultWorkspace(origin: string) {
    if (!this.environmentService.get('IS_MULTIWORKSPACE_ENABLED')) {
      return this.getDefaultWorkspace();
    }

    const { subdomain, customDomain } =
      this.getSubdomainAndCustomDomainFromUrl(origin);

    if (!customDomain && !subdomain) return;

    const where = isDefined(customDomain) ? { customDomain } : { subdomain };

    return (
      (await this.workspaceRepository.findOne({
        where,
        relations: ['workspaceSSOIdentityProviders'],
      })) ?? undefined
    );
  }

  private extractSubdomain(params?: { email?: string; displayName?: string }) {
    if (params?.email) {
      return getSubdomainFromEmail(params.email);
    }

    if (params?.displayName) {
      return getSubdomainNameFromDisplayName(params.displayName);
    }
  }

  async generateSubdomain(params?: { email?: string; displayName?: string }) {
    const subdomain =
      this.extractSubdomain(params) ?? generateRandomSubdomain();

    const existingWorkspaceCount = await this.workspaceRepository.countBy({
      subdomain,
    });

    return `${subdomain}${existingWorkspaceCount > 0 ? `-${Math.random().toString(36).substring(2, 10)}` : ''}`;
  }

  private getCustomWorkspaceUrl(customDomain: string) {
    const url = this.getFrontUrl();

    url.hostname = customDomain;

    return url.toString();
  }

  private getTwentyWorkspaceUrl(subdomain: string) {
    const url = this.getFrontUrl();

    url.hostname = `${subdomain}.${url.hostname}`;

    return url.toString();
  }

  getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain(
    workspace?: WorkspaceSubdomainCustomDomainAndIsCustomDomainEnabledType | null,
  ) {
    if (!workspace) {
      return {
        subdomain: this.environmentService.get('DEFAULT_SUBDOMAIN'),
        customDomain: null,
      };
    }

    if (!workspace.isCustomDomainEnabled) {
      return {
        subdomain: workspace.subdomain,
        customDomain: null,
      };
    }

    return workspace;
  }

  isCustomDomainWorking(customDomainDetails: CustomDomainValidRecords) {
    return customDomainDetails.records.every(
      ({ status }) => status === 'success',
    );
  }

  getWorkspaceUrls({
    subdomain,
    customDomain,
    isCustomDomainEnabled,
  }: WorkspaceSubdomainCustomDomainAndIsCustomDomainEnabledType) {
    return {
      customUrl:
        isCustomDomainEnabled && customDomain
          ? this.getCustomWorkspaceUrl(customDomain)
          : undefined,
      subdomainUrl: this.getTwentyWorkspaceUrl(subdomain),
    };
  }
}
