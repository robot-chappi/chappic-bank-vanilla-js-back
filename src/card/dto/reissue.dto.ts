import { EnumPaymentSystem } from '@prisma/client'
import { IsString } from 'class-validator'

export class ReissueDto {
	@IsString()
	type: EnumPaymentSystem
}
