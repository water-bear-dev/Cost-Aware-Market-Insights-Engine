import boto3
import os

DYNAMODB_ENDPOINT = "http://dynamodb-local:8000"
REGION = "us-east-1"

# S&P 500 Tickers
SP500_TICKERS = [
    "A", "AAL", "AAPL", "ABBV", "ABT", "ACN", "ADBE", "ADI", "ADM", "ADP", "ADSK", "AEE", "AEP", "AES", "AFL", "AIG", "AIZ", "AJG", "AKAM", "ALB", 
    "ALGN", "ALK", "ALL", "ALLE", "AMAT", "AMCR", "AMD", "AME", "AMGN", "AMP", "AMT", "AMZN", "ANET", "ANSS", "AON", "AOS", "APA", "APD", "APH", "APTV", 
    "ARE", "ATO", "AVB", "AVGO", "AVY", "AWK", "AXON", "AXP", "AZO", "BA", "BAC", "BALL", "BAX", "BBWI", "BBY", "BDX", "BEN", "BIIB", "BK", "BKNG", 
    "BKR", "BLK", "BMY", "BR", "BRO", "BRK-B", "BSX", "BWA", "BXP", "C", "CAG", "CAH", "CARR", "CAT", "CB", "CBOE", "CBRE", "CCI", "CCL", "CDNS", 
    "CDW", "CE", "CEG", "CF", "CFG", "CHD", "CHRW", "CHTR", "CI", "CINF", "CL", "CLX", "CMA", "CMCSA", "CME", "CMG", "CMI", "CMS", "CNC", "CNP", 
    "COF", "COO", "COP", "COR", "COST", "CPAY", "CPB", "CPRT", "CSGP", "CSX", "CTAS", "CTRA", "CTSH", "CTVA", "CVS", "CVX", "D", "DAL", "DD", "DE", 
    "DECK", "DFS", "DG", "DGX", "DHI", "DHR", "DIS", "DLR", "DLTR", "DOV", "DOW", "DPZ", "DRI", "DTE", "DUK", "DVA", "DVN", "DXC", "EA", "EBAY", 
    "ECL", "ED", "EFX", "EIX", "EL", "ELV", "EMR", "ENPH", "EOG", "EPAM", "EQIX", "EQR", "ES", "ESS", "ETN", "ETR", "ETSY", "EVRG", "EW", "EXC", 
    "EXPD", "EXPE", "EXR", "F", "FANG", "FAST", "FCX", "FDS", "FE", "FFIV", "FIS", "FISV", "FITB", "FMC", "FOX", "FOXA", "FRT", "FTNT", "FTV", 
    "GD", "GE", "GEHC", "GEN", "GILD", "GIS", "GL", "GLW", "GM", "GNRC", "GOOG", "GOOGL", "GPC", "GPN", "GRMN", "GS", "GWW", "HAL", "HAS", "HBAN", 
    "HCA", "HD", "HES", "HIG", "HII", "HLT", "HOLX", "HON", "HPE", "HPQ", "HRL", "HST", "HSY", "HUBB", "HUM", "HWM", "IBM", "ICE", "IDXX", "IEX", 
    "IFF", "INCY", "INTC", "INTU", "IP", "IPG", "IQV", "IR", "IRM", "ISRG", "IT", "ITW", "IVZ", "J", "JBHT", "JCI", "JKHY", "JNJ", "JNPR", "JPM", 
    "K", "KDP", "KEY", "KEYS", "KHC", "KIM", "KLAC", "KMB", "KMI", "KMX", "KO", "KR", "LDOS", "LEN", "LH", "LHX", "LIN", "LKQ", "LLY", "LMT", 
    "LNC", "LNT", "LOW", "LRCX", "LUV", "LVS", "LW", "LYB", "LYV", "MA", "MAA", "MAR", "MAS", "MCD", "MCHP", "MCK", "MCO", "MDLZ", "MDT", "MET", 
    "META", "MGM", "MHK", "MKC", "MKTX", "MMC", "MMM", "MNST", "MO", "MOS", "MPC", "MRK", "MRO", "MS", "MSCI", "MSFT", "MSI", "MTB", "MTD", 
    "MU", "NCLH", "NDAQ", "NDSN", "NEE", "NEM", "NFLX", "NI", "NKE", "NOC", "NOW", "NRG", "NSC", "NTAP", "NTRS", "NUE", "NVDA", "NVR", "NWL", 
    "NWS", "NWSA", "NXPI", "O", "ODFL", "OMC", "ON", "ORA", "ORCL", "ORLY", "OTIS", "OXY", "PANW", "PARA", "PAYX", "PCAR", "PCG", "PEG", "PEP", 
    "PFE", "PFG", "PG", "PGR", "PH", "PHM", "PKG", "PLD", "PM", "PNC", "PNR", "POOL", "PPG", "PPL", "PRU", "PSA", "PSX", "PTC", "PWR", "PYPL", 
    "QCOM", "QRVO", "RCL", "REG", "REGN", "RF", "RHI", "RJF", "RL", "RMD", "ROK", "ROP", "ROST", "RSG", "RTX", "RVTY", "SBAC", "SBUX", "SCHW", 
    "SHW", "SJM", "SLB", "SNA", "SNPS", "SO", "SPG", "SPGI", "SRE", "STE", "STT", "STX", "STZ", "SWK", "SWKS", "SYF", "SYK", "SYY", "T", "TAP", 
    "TDG", "TDY", "TECH", "TEL", "TER", "TFC", "TFX", "TGT", "TJX", "TMO", "TMUS", "TPR", "TRGP", "TRMB", "TROW", "TRV", "TSCO", "TSLA", "TSN", 
    "TT", "TTD", "TTWO", "TXN", "TXT", "TYL", "UAL", "UDR", "UHS", "ULTA", "UNH", "UNP", "UPS", "URI", "USB", "V", "VEEV", "VFC", "VLO", "VMC", 
    "VNO", "VRSK", "VRSN", "VRTX", "VTR", "VZ", "WAB", "WAT", "WBA", "WDC", "WEC", "WELL", "WFC", "WHR", "WM", "WMB", "WMT", "WRB", "WST", 
    "WTW", "WY", "WYNN", "XEL", "XOM", "XRAY", "XYL", "YUM", "ZBH", "ZBRA", "ZION", "ZTS"
]

# ASX 200 Tickers
ASX200_TICKERS = [
    "AAD.AX", "ABC.AX", "ABP.AX", "AGL.AX", "AKE.AX", "ALL.AX", "ALQ.AX", "ALU.AX", "AMC.AX", "AMP.AX", 
    "ANN.AX", "ANZ.AX", "APA.AX", "APM.AX", "ARB.AX", "ASB.AX", "AWC.AX", "AZJ.AX", "BAP.AX", "BGA.AX", 
    "BHP.AX", "BKL.AX", "BPT.AX", "BRG.AX", "BSL.AX", "BXB.AX", "CAR.AX", "CBA.AX", "CGF.AX", "CHC.AX", 
    "CIM.AX", "CLW.AX", "CMW.AX", "CNU.AX", "COH.AX", "COL.AX", "CPU.AX", "CQR.AX", "CTD.AX", "CWP.AX", 
    "DMP.AX", "DRR.AX", "DTL.AX", "DXS.AX", "ELD.AX", "EVN.AX", "FCL.AX", "FMG.AX", "FPH.AX", "GDI.AX", 
    "GNC.AX", "GOZ.AX", "GPT.AX", "GUD.AX", "GWA.AX", "HLS.AX", "HPI.AX", "HSO.AX", "HVN.AX", "IAG.AX", 
    "IEL.AX", "IFL.AX", "IGO.AX", "ILU.AX", "INA.AX", "IPL.AX", "IRE.AX", "IVC.AX", "JBH.AX", "JHX.AX", 
    "KGN.AX", "LLC.AX", "LNK.AX", "LYC.AX", "MGR.AX", "MIN.AX", "MME.AX", "MPL.AX", "MQG.AX", "MSD.AX", 
    "MYS.AX", "NAB.AX", "NAN.AX", "NCM.AX", "NHF.AX", "NUF.AX", "NWS.AX", "OML.AX", "ORG.AX", "ORI.AX", 
    "OSH.AX", "OZL.AX", "PGH.AX", "PMV.AX", "PPT.AX", "PRY.AX", "QAN.AX", "QBE.AX", "QUB.AX", "RHC.AX", 
    "RIO.AX", "RMD.AX", "RRL.AX", "RSG.AX", "RWC.AX", "S32.AX", "SBM.AX", "SCG.AX", "SCP.AX", "SDA.AX", 
    "SEK.AX", "SGM.AX", "SGP.AX", "SHL.AX", "SKI.AX", "SKO.AX", "SLK.AX", "SNZ.AX", "SOL.AX", "SPK.AX", 
    "SPT.AX", "SRK.AX", "SSW.AX", "STO.AX", "SUN.AX", "SVW.AX", "SWM.AX", "SYD.AX", "SYR.AX", "TAH.AX", 
    "TGR.AX", "TLS.AX", "TME.AX", "TPW.AX", "TWE.AX", "URW.AX", "VCX.AX", "VEA.AX", "VOC.AX", "WBC.AX", 
    "WES.AX", "WHC.AX", "WOR.AX", "WOW.AX", "WPL.AX", "WSA.AX", "XRO.AX", "ZEL.AX"
]

def seed():
    all_tickers = sorted(list(set(SP500_TICKERS + ASX200_TICKERS)))
    print(f"Seeding {len(all_tickers)} tickers...")
    
    dynamodb = boto3.resource('dynamodb', endpoint_url=DYNAMODB_ENDPOINT, region_name=REGION)
    table = dynamodb.Table('Tickers')
    
    with table.batch_writer() as batch:
        for ticker in all_tickers:
            batch.put_item(Item={'ticker': ticker})
            
    print("Seeding complete.")

if __name__ == "__main__":
    seed()
