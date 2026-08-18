/**
 * 共享 Zod 校验器 - 封装 ip-utils.ts 中的网络校验函数
 */
import { z } from 'zod';
import { isValidIP, isValidCIDR, validateGateway, validateIPAssignment } from '../ip-utils';

/** 校验 IPv4 地址格式 */
export const ipString = z.string().refine(isValidIP, {
  message: '无效的 IP 地址格式',
});

/** 校验 CIDR 格式（如 192.168.1.0/24） */
export const cidrString = z.string().refine(isValidCIDR, {
  message: '无效的 CIDR 格式',
});

/** 可选 IP（空字符串视为通过） */
export const optionalIP = z.string().refine(
  (v) => !v || isValidIP(v),
  { message: '无效的 IP 地址格式' },
);

/** 校验网关 IP 是否在子网范围内 */
export const gatewayInCidr = (cidr: string) =>
  z.string().refine(
    (gw) => !gw || validateGateway(gw, cidr).valid,
    { message: '网关地址不在子网范围内' },
  );

/** 校验分配 IP 是否在子网范围内 */
export const ipInCidr = (cidr: string) =>
  z.string().refine(
    (ip) => !ip || validateIPAssignment(ip, cidr).valid,
    { message: 'IP 地址不在子网范围内' },
  );

/** 正整数（端口号、数量等） */
export const positiveInt = z.number().int().positive();

/** 端口号范围 1-65535 */
export const portNumber = z.number().int().min(1, '端口号不能小于 1').max(65535, '端口号不能大于 65535');
