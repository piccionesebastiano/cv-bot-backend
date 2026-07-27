import {
  IsString,
  IsIn,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DEVICES, SITE_EVENT_TYPES, Device, SiteEventType } from '../site-analytics.service';

/**
 * One flat shape for all four event types: the fields are all bounded, so the
 * service can switch on `type` without a discriminated-union validator.
 */
export class SiteEventDto {
  @IsIn(SITE_EVENT_TYPES as unknown as string[], { message: 'Tipo evento non riconosciuto.' })
  type: SiteEventType;

  @IsString()
  @MaxLength(200)
  path: string;

  @IsIn(DEVICES as unknown as string[])
  device: Device;

  /** % of viewport width — reflow-safe horizontal position. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  x?: number;

  /** Absolute px from the top of the document. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200000)
  y?: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  selector?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsBoolean()
  rage?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  scroll?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(7200)
  seconds?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200000)
  docHeight?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  viewportWidth?: number;

  /** Referrer host only. The tracker never sends a full URL. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referrer?: string;
}

export class SiteEventsDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  @IsArray()
  @ArrayNotEmpty()
  // 40 eventi con selettori stanno abbondantemente sotto il limite di 16kb
  // impostato sul body in main.ts.
  @ArrayMaxSize(40, { message: 'Batch troppo grande (max 40 eventi).' })
  @ValidateNested({ each: true })
  @Type(() => SiteEventDto)
  events: SiteEventDto[];
}
