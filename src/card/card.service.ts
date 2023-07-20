import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import { EnumPaymentSystem, EnumTransactionType } from '@prisma/client'
import { PrismaService } from 'src/prisma.service'
import { UserService } from 'src/user/user.service'
import {
	generateCardNumberAndSystem,
	generateCardWithType,
	regenerateCardNumber
} from 'src/utils/bank/generate-bank-card-number'
import { getRandomNumber } from 'src/utils/random-number'
import { TransactionService } from '../transaction/transaction.service'
import { generateExpiryDate } from '../utils/bank/generate-expire-date'
import { cardOutput } from './card.output'
import { BalanceDto } from './dto/balance.dto'
import { TransferDto } from './dto/transfer.dto'

@Injectable()
export class CardService {
	constructor(
		private prisma: PrismaService,
		private transactionService: TransactionService,
		private userService: UserService
	) {}

	async #byId(id: number) {
		const card = await this.prisma.card.findUnique({
			where: {
				id
			},
			select: cardOutput
		})

		if (!card) throw new NotFoundException('Card not found!')
		return card
	}

	async #byNumber(number: string) {
		const card = await this.prisma.card.findUnique({
			where: {
				number
			},
			select: cardOutput
		})

		if (!card) throw new NotFoundException('Card not found!')
		return card
	}

	async #updateCurrentCard(userId: number, type: EnumPaymentSystem) {
		const number = generateCardWithType(type)
		const cvc = getRandomNumber(100, 999)
		const expireDate = generateExpiryDate()

		const user = await this.userService.byId(userId)

		if (!user || !user.card)
			throw new BadRequestException('User or card not found!')

		const card = await this.prisma.card.update({
			where: { userId: userId },
			data: {
				expireDate,
				cvc,
				number,
				paymentSystem: type
			}
		})

		return card
	}

	async reissueCard(userId: number, { type }: { type: EnumPaymentSystem }) {
		const updatedCard = await this.#updateCurrentCard(userId, type)

		return updatedCard
	}

	async updateCardData(userId: number) {
		const user = await this.userService.byId(userId)

		if (!user || !user.card)
			throw new BadRequestException('User or card is not found!')

		const number = regenerateCardNumber(user.card.number)
		const cvc = getRandomNumber(100, 999)
		const expireDate = generateExpiryDate()

		const card = await this.prisma.card.update({
			where: {
				userId: userId
			},
			data: {
				cvc,
				number,
				expireDate
			}
		})

		return card
	}

	async create(userId: number) {
		const { number, paymentSystem } = generateCardNumberAndSystem()
		const cvc = getRandomNumber(100, 999)
		const expireDate = generateExpiryDate()

		const user = await this.userService.byId(userId)

		if (user.card) throw new BadRequestException('User already has a card!')

		const card = await this.prisma.card.create({
			data: {
				expireDate,
				cvc,
				number,
				paymentSystem,
				user: {
					connect: {
						id: userId
					}
				}
			}
		})

		return card
	}

	async getUserCard(userId: number) {
		const user = await this.userService.byId(userId)

		return user?.card || {}
	}

	async updateBalance(
		userId: number,
		{ amount }: BalanceDto,
		type: EnumTransactionType
	) {
		const user = await this.userService.byId(userId)

		return this.prisma.card.update({
			where: {
				userId: user.id
			},

			data: {
				balance: {
					[type === EnumTransactionType.TOP_UP ? 'increment' : 'decrement']:
						amount
				}
			}
		})
	}

	async transferMoney(userId: number, dto: TransferDto) {
		const user = await this.userService.byId(userId)
		if (!user.card)
			throw new BadRequestException('Please create card for transfer!')

		const senderCard = await this.#byNumber(user.card.number)
		const recipientCard = await this.#byNumber(dto.toCardNumber)

		if (!senderCard || !recipientCard)
			throw new NotFoundException('Sender or recipient card not found!')

		await this.updateBalance(
			senderCard.userId,
			dto,
			EnumTransactionType.WITHDRAWAL
		)
		await this.updateBalance(
			recipientCard.userId,
			dto,
			EnumTransactionType.TOP_UP
		)

		await this.transactionService.create(
			senderCard.id,
			{ type: EnumTransactionType.WITHDRAWAL },
			dto.amount
		)
		await this.transactionService.create(
			recipientCard.id,
			{ type: EnumTransactionType.TOP_UP },
			dto.amount
		)

		return { message: 'Success' }
	}
}
