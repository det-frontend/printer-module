import Header from '@/app/components/Header'
import Voucher from '@/app/components/Voucher'
import { colors } from '@/constants/tokens'
import { Token, useStore } from '@/store/library'
import { utilsStyles } from '@/styles'
import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
import { ActivityIndicator } from 'react-native-paper'
import SerialPortAPI from 'react-native-serial-port-api'
import tw from 'twrnc'

interface StationInfo {
	name: string
	address: string
	city: string
	state: string
	phone1: string
	phone2: string
}

interface VoucherData {
	dailyReportDate: { toString: () => string }
	createAt: string
	nozzleNo: string
	vocono: string
	salePrice: { toString: () => string }
	saleLiter: { toString: () => string }
	totalPrice: { toString: () => string }
	fuelType: string
}

const Index: React.FC = () => {
	const dateRange = useMemo(() => {
		const start = new Date()
		start.setHours(0, 0, 0, 0)

		const end = new Date()
		end.setHours(23, 59, 59, 999)

		return { start, end }
	}, [])

	const { items, isLoading, error, fetchItems } = useStore() as {
		items: { result: VoucherData[] }
		isLoading: boolean
		error: any
		fetchItems: (route: string, token: string) => void
	}
	const { items: token } = Token() as { items: string }

	const [stationInfo, setStationInfo] = useState<StationInfo>({
		name: '',
		address: '',
		city: '',
		state: '',
		phone1: '',
		phone2: '',
	})

	useEffect(() => {
		const loadStationInfo = async () => {
			try {
				const jsonValue = await AsyncStorage.getItem('info')
				const data = jsonValue ? JSON.parse(jsonValue) : null

				if (data) {
					setStationInfo({
						name: data.name || '',
						address: data.address || '',
						city: data.city || '',
						state: data.state || '',
						phone1: data.phone1 || '',
						phone2: data.phone2 || '',
					})
				}
			} catch (error) {
				console.error('Error loading station info:', error)
			}
		}

		loadStationInfo()
	}, [])

	const route = useMemo(
		() => `detail-sale/pagi/by-date/1?sDate=${dateRange.start}&eDate=${dateRange.end}`,
		[dateRange],
	)

	useEffect(() => {
		fetchItems(route, token)
	}, [fetchItems, route, token])

	const ItemDivider = useCallback(
		() => <View style={[utilsStyles.itemSeparator, styles.divider]} />,
		[],
	)

	const convertToHex = useCallback((str: string): string => {
		return str
			.split('')
			.map((char) => char.charCodeAt(0).toString(16))
			.join('')
	}, [])

	const sendToPrinter = useCallback(
		async (data: VoucherData) => {
			try {
				const serialPort = await SerialPortAPI.open('/dev/ttyS5', {
					baudRate: 9600,
				})

				const { name, address, city, state, phone1, phone2 } = stationInfo

				const stationName = convertToHex(name)
				const location = convertToHex(`${address}, ${city}, ${state}`)
				const phone1Hex = convertToHex(phone1)
				const phone2Hex = convertToHex(phone2)
				const date = convertToHex(data.dailyReportDate.toString())
				const time = convertToHex(data.createAt.slice(11, 19))
				const noz = convertToHex(data.nozzleNo)
				const vocono = convertToHex(data.vocono)
				const basePrice = convertToHex(data.salePrice.toString())
				const liter = convertToHex(data.saleLiter.toString())
				const total = convertToHex(data.totalPrice.toString())
				const fuel = convertToHex(data.fuelType)

				const commands = [
					`1B401B6101${stationName}0A`,
					`${location}0A`,
					`${phone1Hex}2C20${phone2Hex}0A`,
					'1B6100',
					'2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D0A',
					`564F434F4E4F202020${vocono}0A`,
					`444154452020202020${date}0A`,
					`54494D452020202020${time}0A`,
					`4E4F5A5A4C45202020${noz}0A`,
					'2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D0A',
					`4655454C20202020${fuel}0A`,
					`4241534520505249434520202020${basePrice}204D4D4B202F204C495445520A`,
					`53414C45204C4954455253202020${liter}204C490A`,
					`544F54414C202020202020202020${total}204D4D4B0A`,
					`202020202020202020202020202028494E434C555349564520544158290A`,
					'2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D0A',
					'1B6101',
					'5448414E4B20594F5520464F52205649534954494E470A',
					'1B6401',
					'1D564100',
				]

				for (const command of commands) {
					await serialPort.send(command)
				}
			} catch (error) {
				console.error('Error sending to printer:', error)
			}
		},
		[convertToHex, stationInfo],
	)

	const renderItem = useCallback(
		({ item }: { item: VoucherData }) => (
			<View>
				<Voucher onClick={() => sendToPrinter(item)} data={item} />
			</View>
		),
		[sendToPrinter],
	)

	const keyExtractor = useCallback((item: VoucherData, index: number) => `key-${index}`, [])

	return (
		<>
			<Header />
			<View style={tw`px-6 py-2`}>
				{items?.result ? (
					<FlatList
						data={items.result}
						contentContainerStyle={styles.listContent}
						ListFooterComponent={ItemDivider}
						ItemSeparatorComponent={ItemDivider}
						keyExtractor={keyExtractor}
						renderItem={renderItem}
					/>
				) : (
					<ActivityIndicator
						animating={true}
						style={tw`mt-[200px]`}
						size={80}
						color={colors.primary}
					/>
				)}
			</View>
		</>
	)
}

const styles = StyleSheet.create({
	divider: {
		marginVertical: 9,
		marginLeft: 60,
	},
	listContent: {
		paddingTop: 10,
		paddingBottom: 128,
	},
})

export default Index
