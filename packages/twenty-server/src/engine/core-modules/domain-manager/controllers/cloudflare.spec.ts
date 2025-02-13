import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import { Request, Response } from 'express';

import { CloudflareController } from 'src/engine/core-modules/domain-manager/controllers/cloudflare.controller';
import { Workspace } from 'src/engine/core-modules/workspace/workspace.entity';
import { DomainManagerService } from 'src/engine/core-modules/domain-manager/services/domain-manager.service';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { EnvironmentService } from 'src/engine/core-modules/environment/environment.service';
import { HttpExceptionHandlerService } from 'src/engine/core-modules/exception-handler/http-exception-handler.service';
import { CustomDomainValidRecords } from 'src/engine/core-modules/domain-manager/dtos/custom-domain-valid-records';
import { CustomDomainService } from 'src/engine/core-modules/domain-manager/services/custom-domain.service';

describe('CloudflareController - customHostnameWebhooks', () => {
  let controller: CloudflareController;
  let WorkspaceRepository: Repository<Workspace>;
  let environmentService: EnvironmentService;
  let domainManagerService: DomainManagerService;
  let customDomainService: CustomDomainService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CloudflareController],
      providers: [
        {
          provide: getRepositoryToken(Workspace, 'core'),
          useValue: {
            findOneBy: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: DomainManagerService,
          useValue: {
            isCustomDomainWorking: jest.fn(),
          },
        },
        {
          provide: CustomDomainService,
          useValue: {
            getCustomDomainDetails: jest.fn(),
          },
        },
        {
          provide: HttpExceptionHandlerService,
          useValue: {
            handleError: jest.fn(),
          },
        },
        {
          provide: ExceptionHandlerService,
          useValue: {
            captureExceptions: jest.fn(),
          },
        },
        {
          provide: EnvironmentService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<CloudflareController>(CloudflareController);
    WorkspaceRepository = module.get(getRepositoryToken(Workspace, 'core'));
    environmentService = module.get<EnvironmentService>(EnvironmentService);
    domainManagerService =
      module.get<DomainManagerService>(DomainManagerService);
    customDomainService = module.get<CustomDomainService>(CustomDomainService);
  });

  it('should handle exception and return status 200 if hostname is missing', async () => {
    const req = {
      headers: { 'cf-webhook-auth': 'correct-secret' },
      body: { data: { data: {} } },
    } as unknown as Request;
    const sendMock = jest.fn();
    const res = {
      status: jest.fn().mockReturnThis(),
      send: sendMock,
    } as unknown as Response;

    jest.spyOn(environmentService, 'get').mockReturnValue('correct-secret');

    await controller.customHostnameWebhooks(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendMock).toHaveBeenCalled();
  });

  it('should update workspace for a valid hostname and save changes', async () => {
    const req = {
      headers: { 'cf-webhook-auth': 'correct-secret' },
      body: { data: { data: { hostname: 'example.com' } } },
    } as unknown as Request;
    const sendMock = jest.fn();
    const res = {
      status: jest.fn().mockReturnThis(),
      send: sendMock,
    } as unknown as Response;

    jest.spyOn(environmentService, 'get').mockReturnValue('correct-secret');
    jest
      .spyOn(customDomainService, 'getCustomDomainDetails')
      .mockResolvedValue({
        records: [
          {
            success: true,
          },
        ],
      } as unknown as CustomDomainValidRecords);
    jest
      .spyOn(domainManagerService, 'isCustomDomainWorking')
      .mockReturnValue(true);
    jest.spyOn(WorkspaceRepository, 'findOneBy').mockResolvedValue({
      customDomain: 'example.com',
      isCustomDomainEnabled: false,
    } as Workspace);

    await controller.customHostnameWebhooks(req, res);

    expect(WorkspaceRepository.findOneBy).toHaveBeenCalledWith({
      customDomain: 'example.com',
    });
    expect(customDomainService.getCustomDomainDetails).toHaveBeenCalledWith(
      'example.com',
    );
    expect(WorkspaceRepository.save).toHaveBeenCalledWith({
      customDomain: 'example.com',
      isCustomDomainEnabled: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendMock).toHaveBeenCalled();
  });

  it('should remove customDomain if no hostname found', async () => {
    const req = {
      headers: { 'cf-webhook-auth': 'correct-secret' },
      body: { data: { data: { hostname: 'notfound.com' } } },
    } as unknown as Request;
    const sendMock = jest.fn();
    const res = {
      status: jest.fn().mockReturnThis(),
      send: sendMock,
    } as unknown as Response;

    jest.spyOn(environmentService, 'get').mockReturnValue('correct-secret');
    jest.spyOn(WorkspaceRepository, 'findOneBy').mockResolvedValue({
      customDomain: 'notfound.com',
      isCustomDomainEnabled: true,
    } as Workspace);

    jest
      .spyOn(customDomainService, 'getCustomDomainDetails')
      .mockResolvedValue(undefined);

    await controller.customHostnameWebhooks(req, res);

    expect(WorkspaceRepository.findOneBy).toHaveBeenCalledWith({
      customDomain: 'notfound.com',
    });
    expect(WorkspaceRepository.save).toHaveBeenCalledWith({
      customDomain: null,
      isCustomDomainEnabled: false,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendMock).toHaveBeenCalled();
  });
  it('should do nothing if nothing changes', async () => {
    const req = {
      headers: { 'cf-webhook-auth': 'correct-secret' },
      body: { data: { data: { hostname: 'nothing-change.com' } } },
    } as unknown as Request;
    const sendMock = jest.fn();
    const res = {
      status: jest.fn().mockReturnThis(),
      send: sendMock,
    } as unknown as Response;

    jest.spyOn(environmentService, 'get').mockReturnValue('correct-secret');
    jest.spyOn(WorkspaceRepository, 'findOneBy').mockResolvedValue({
      customDomain: 'nothing-change.com',
      isCustomDomainEnabled: true,
    } as Workspace);
    jest
      .spyOn(customDomainService, 'getCustomDomainDetails')
      .mockResolvedValue({
        records: [
          {
            success: true,
          },
        ],
      } as unknown as CustomDomainValidRecords);
    jest
      .spyOn(domainManagerService, 'isCustomDomainWorking')
      .mockReturnValue(true);

    await controller.customHostnameWebhooks(req, res);

    expect(WorkspaceRepository.findOneBy).toHaveBeenCalledWith({
      customDomain: 'nothing-change.com',
    });
    expect(WorkspaceRepository.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendMock).toHaveBeenCalled();
  });
});
